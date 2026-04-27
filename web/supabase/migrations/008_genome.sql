-- Protocol v1: Genome tab
-- Adds storage for derived genome traits computed from a 23andMe raw upload.
--
-- We deliberately do NOT persist the user's raw genotypes (the 600k-row TSV
-- contains the user's full SNP profile and its threat model is much larger
-- than per-SNP coaching insights). Instead the upload flow parses the file in
-- the API route, matches a curated catalog of well-validated SNPs, and writes
-- only the derived per-trait values + plain-English coaching notes here.
--
-- Shape of `genome_traits` (jsonb):
-- {
--   "caffeine_metabolism": {
--     "value": "fast",
--     "coaching": "...",
--     "rsid": "rs762551",
--     "gene": "CYP1A2",
--     "genotype": "AA"
--   },
--   "muscle_fiber_bias": { ... },
--   ...
-- }
--
-- RLS is already enabled on user_profile in 004_protocol_v1.sql; the
-- "Users can CRUD own user_profile" policy covers reads/writes of the new
-- columns automatically.

alter table public.user_profile
  add column genome_traits jsonb not null default '{}'::jsonb;

alter table public.user_profile
  add column genome_uploaded_at timestamptz;
