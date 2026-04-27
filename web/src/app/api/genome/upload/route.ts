import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseTwentyThreeAndMe, traitsFromGenotypes } from '@/lib/genome/parser';

/**
 * POST /api/genome/upload
 *
 * Accepts either:
 *   - multipart/form-data with a single `file` field (the .txt/.tsv 23andMe
 *     raw download), or
 *   - application/json with `{ "raw": string }`
 *
 * The route parses the raw genotypes, matches them against the curated SNP
 * catalog, derives plain-English coaching traits, and writes ONLY those
 * derived traits to `user_profile.genome_traits`. The raw genotypes are
 * never persisted — the request body is the only place they exist on the
 * server, and it falls out of memory once the response is sent.
 *
 * Response: { traits: GenomeTraits, count: number, total_catalog: number }
 *   - count: number of catalog SNPs successfully matched
 *   - total_catalog: number of non-compound traits in the catalog (denominator)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 23andMe raw downloads are typically ~10-25MB uncompressed; allow some
// headroom but cap the body to avoid memory abuse.
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';

  let raw = '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') {
        return NextResponse.json(
          { error: 'missing file field' },
          { status: 400 }
        );
      }
      if (file.size > MAX_BODY_BYTES) {
        return NextResponse.json(
          { error: `file too large (max ${MAX_BODY_BYTES} bytes)` },
          { status: 413 }
        );
      }
      raw = await file.text();
    } else if (contentType.includes('application/json')) {
      const body = (await req.json().catch(() => null)) as
        | { raw?: unknown }
        | null;
      if (!body || typeof body.raw !== 'string') {
        return NextResponse.json(
          { error: 'expected JSON body { raw: string }' },
          { status: 400 }
        );
      }
      if (body.raw.length > MAX_BODY_BYTES) {
        return NextResponse.json(
          { error: `raw too large (max ${MAX_BODY_BYTES} bytes)` },
          { status: 413 }
        );
      }
      raw = body.raw;
    } else {
      return NextResponse.json(
        { error: 'expected multipart/form-data or application/json' },
        { status: 415 }
      );
    }
  } catch (err) {
    console.error('[genome/upload] body parse error', err);
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  if (!raw.trim()) {
    return NextResponse.json({ error: 'empty file' }, { status: 400 });
  }

  // Parse → derive traits. Both functions are pure and never touch the DB.
  const genotypes = parseTwentyThreeAndMe(raw);
  const traits = traitsFromGenotypes(genotypes);

  const matchedRsids = Object.keys(genotypes).length;
  if (matchedRsids === 0) {
    return NextResponse.json(
      {
        error:
          'no catalog SNPs found in this file — is this a 23andMe raw data download?',
      },
      { status: 422 }
    );
  }

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('user_profile')
    .update({
      genome_traits: traits,
      genome_uploaded_at: nowIso,
    })
    .eq('user_id', user.id);

  if (error) {
    console.error('[genome/upload] update error', error);
    return NextResponse.json(
      { error: 'failed to save genome traits' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    traits,
    count: Object.keys(traits).length,
    matched_rsids: matchedRsids,
    uploaded_at: nowIso,
  });
}
