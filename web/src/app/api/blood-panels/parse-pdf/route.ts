import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, MODEL_SONNET } from '@/lib/claude/client';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/blood-panels/parse-pdf
 *
 * multipart/form-data with `file` (PDF or image, <= 10 MB). Calls Claude
 * Sonnet 4.6 with the file as document/image content + a forced `emit_blood_panel`
 * tool-use call. Returns the parsed panel WITHOUT persisting — the client
 * shows it in a confirmation modal and POSTs to /api/blood-panels to commit.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PDF_MEDIA = 'application/pdf';

const PARSE_SYSTEM_PROMPT = `You are a medical lab report parser. Extract the panel_date (ISO yyyy-mm-dd), lab name, and individual marker readings from this blood panel PDF or photo. For each marker, return its name (lowercase + underscores, e.g. \`ldl\`, \`apoB\`, \`hsCRP\`), value (number), unit (string, e.g. \`mg/dL\`), and reference range if present. Only output via the emit_blood_panel tool. Be conservative: if you can't read a value clearly, omit it rather than guess.`;

const EMIT_BLOOD_PANEL_SCHEMA = {
  type: 'object',
  properties: {
    panel_date: {
      type: 'string',
      description: 'Date of the panel as YYYY-MM-DD (ISO date).',
    },
    lab: {
      type: 'string',
      description: 'Lab name, e.g. "Quest Diagnostics" or "LabCorp". Empty string if not visible.',
    },
    readings: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          marker: {
            type: 'string',
            description:
              'Marker name as a lowercase token (use camelCase only for established acronyms like apoB / hsCRP / hbA1c). e.g. "ldl", "hdl", "apoB", "hsCRP", "hbA1c".',
          },
          value: { type: 'number' },
          unit: { type: 'string' },
          reference_low: { type: 'number' },
          reference_high: { type: 'number' },
        },
        required: ['marker', 'value', 'unit'],
      },
    },
  },
  required: ['panel_date', 'readings'],
} as const;

interface ParsedReading {
  marker: string;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
}

interface ParsedPanel {
  panel_date: string;
  lab: string;
  readings: ParsedReading[];
}

function validateEmitBloodPanel(value: unknown): ParsedPanel {
  if (!value || typeof value !== 'object') {
    throw new Error('emit_blood_panel input is not an object');
  }
  const v = value as Record<string, unknown>;

  if (typeof v.panel_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v.panel_date)) {
    throw new Error('panel_date must be a YYYY-MM-DD string');
  }
  const lab = typeof v.lab === 'string' ? v.lab : '';

  if (!Array.isArray(v.readings) || v.readings.length === 0) {
    throw new Error('readings must be a non-empty array');
  }

  const readings: ParsedReading[] = [];
  for (const raw of v.readings) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const marker = typeof r.marker === 'string' ? r.marker.trim() : '';
    const val =
      typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
    const unit = typeof r.unit === 'string' ? r.unit.trim() : '';
    if (!marker || val === null || !unit) continue;
    const low =
      typeof r.reference_low === 'number' && Number.isFinite(r.reference_low)
        ? r.reference_low
        : null;
    const high =
      typeof r.reference_high === 'number' && Number.isFinite(r.reference_high)
        ? r.reference_high
        : null;
    readings.push({ marker, value: val, unit, reference_low: low, reference_high: high });
  }

  if (readings.length === 0) {
    throw new Error('no usable readings parsed');
  }

  return {
    panel_date: v.panel_date.slice(0, 10),
    lab: lab.slice(0, 200),
    readings,
  };
}

type DocumentMediaType = 'application/pdf';
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

async function callClaude(args: {
  base64: string;
  mediaType: DocumentMediaType | ImageMediaType;
}): Promise<ParsedPanel> {
  const anthropic = getAnthropic();

  const fileBlock: Anthropic.ContentBlockParam =
    args.mediaType === PDF_MEDIA
      ? {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: args.base64,
          },
        }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: args.mediaType,
            data: args.base64,
          },
        };

  const response = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 2048,
    temperature: 0,
    system: PARSE_SYSTEM_PROMPT,
    tools: [
      {
        name: 'emit_blood_panel',
        description:
          'Emit the parsed blood panel: panel_date, optional lab, and an array of marker readings.',
        input_schema: EMIT_BLOOD_PANEL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_blood_panel' },
    messages: [
      {
        role: 'user',
        content: [
          fileBlock,
          {
            type: 'text',
            text: 'Parse this blood panel. Output only via emit_blood_panel. Omit any marker you cannot read clearly.',
          },
        ],
      },
    ],
  });

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
  );
  if (!toolBlock) {
    throw new Error('model returned no tool call');
  }
  return validateEmitBloodPanel(toolBlock.input);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  const fileRaw = form.get('file');
  if (!(fileRaw instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  const file = fileRaw;

  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'file too large (max 10 MB)' },
      { status: 413 }
    );
  }

  const mediaTypeRaw = file.type;
  let mediaType: DocumentMediaType | ImageMediaType;
  if (mediaTypeRaw === PDF_MEDIA) {
    mediaType = PDF_MEDIA;
  } else if (ALLOWED_IMAGE.has(mediaTypeRaw)) {
    mediaType = mediaTypeRaw as ImageMediaType;
  } else {
    return NextResponse.json(
      { error: 'unsupported media type (pdf / jpeg / png / webp / gif only)' },
      { status: 415 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString('base64');

  let parsed: ParsedPanel;
  try {
    parsed = await callClaude({ base64, mediaType });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[blood-panels/parse-pdf] parse failed', detail);
    return NextResponse.json(
      { error: 'could not parse panel', detail },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    phase: 'parse',
    panel_date: parsed.panel_date,
    lab: parsed.lab,
    readings: parsed.readings,
  });
}
