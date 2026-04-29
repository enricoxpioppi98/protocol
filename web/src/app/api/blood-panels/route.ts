import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type {
  BloodMarkerFlag,
  BloodPanelSource,
} from '@/lib/types/models';

/**
 * /api/blood-panels
 *
 *   POST   { panel_date, lab?, notes?, source?, readings: [{marker, value, unit, reference_low?, reference_high?}] }
 *          → insert one panel row + N marker readings (server-side `flag` derived
 *            from the reference range when both bounds are present).
 *   DELETE ?id=<uuid>
 *          → delete a panel row (cascades readings via the FK in migration 010).
 *
 * RLS scopes everything to the authenticated user; we still verify auth and
 * stamp `user_id` explicitly so a missing JWT cookie short-circuits before
 * any DB work.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SOURCES = new Set<BloodPanelSource>(['manual', 'pdf_upload']);

interface IncomingReading {
  marker: string;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
}

function deriveFlag(
  value: number,
  low: number | null,
  high: number | null
): BloodMarkerFlag | null {
  if (low === null && high === null) return null;
  if (low !== null && value < low) return 'low';
  if (high !== null && value > high) return 'high';
  return 'normal';
}

function coerceReading(raw: unknown): IncomingReading | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'reading is not an object' };
  const r = raw as Record<string, unknown>;
  const marker = typeof r.marker === 'string' ? r.marker.trim() : '';
  if (!marker) return { error: 'reading.marker required' };
  const value = typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
  if (value === null) return { error: `reading.value must be a number (marker: ${marker})` };
  const unit = typeof r.unit === 'string' ? r.unit.trim() : '';
  if (!unit) return { error: `reading.unit required (marker: ${marker})` };

  const low =
    typeof r.reference_low === 'number' && Number.isFinite(r.reference_low)
      ? r.reference_low
      : null;
  const high =
    typeof r.reference_high === 'number' && Number.isFinite(r.reference_high)
      ? r.reference_high
      : null;

  return { marker, value, unit, reference_low: low, reference_high: high };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | {
        panel_date?: unknown;
        lab?: unknown;
        notes?: unknown;
        source?: unknown;
        readings?: unknown;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: 'expected JSON body' }, { status: 400 });
  }

  const panelDate =
    typeof body.panel_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(body.panel_date)
      ? body.panel_date.slice(0, 10)
      : null;
  if (!panelDate) {
    return NextResponse.json(
      { error: 'panel_date required (YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  const lab = typeof body.lab === 'string' ? body.lab.slice(0, 200) : '';
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : '';
  const source: BloodPanelSource =
    typeof body.source === 'string' && VALID_SOURCES.has(body.source as BloodPanelSource)
      ? (body.source as BloodPanelSource)
      : 'manual';

  if (!Array.isArray(body.readings) || body.readings.length === 0) {
    return NextResponse.json(
      { error: 'readings array required (>= 1 marker)' },
      { status: 400 }
    );
  }

  const coerced: IncomingReading[] = [];
  for (const raw of body.readings) {
    const result = coerceReading(raw);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    coerced.push(result);
  }

  // Insert panel first, then bulk-insert readings against its id. We rely on
  // RLS to scope; a failed readings insert returns the panel for cleanup.
  const { data: panel, error: panelErr } = await supabase
    .from('blood_panels')
    .insert({
      user_id: user.id,
      panel_date: panelDate,
      lab,
      notes,
      source,
    })
    .select('*')
    .single();

  if (panelErr || !panel) {
    console.error('[blood-panels] panel insert error', panelErr);
    return NextResponse.json({ error: 'failed to save panel' }, { status: 500 });
  }

  const readingRows = coerced.map((r) => ({
    panel_id: panel.id,
    marker: r.marker,
    value: r.value,
    unit: r.unit,
    reference_low: r.reference_low,
    reference_high: r.reference_high,
    flag: deriveFlag(r.value, r.reference_low, r.reference_high),
  }));

  const { data: readings, error: readingsErr } = await supabase
    .from('blood_marker_readings')
    .insert(readingRows)
    .select('*');

  if (readingsErr) {
    console.error('[blood-panels] readings insert error', readingsErr);
    // Best-effort cleanup of the orphaned panel — RLS will allow it.
    await supabase.from('blood_panels').delete().eq('id', panel.id);
    return NextResponse.json(
      { error: 'failed to save readings' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    panel: { ...panel, readings: readings ?? [] },
  });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('blood_panels')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[blood-panels] delete error', error);
    return NextResponse.json({ error: 'failed to delete panel' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
