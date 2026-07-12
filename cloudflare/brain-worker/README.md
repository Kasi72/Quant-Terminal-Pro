# PBFB Brain Worker (Sprint 2)

Cloudflare Worker providing Vectorize fingerprint matching and Workers AI narration
for the Brain V2 intelligence loop. Everything runs on the Cloudflare free tier.

## One-time setup

```bash
cd cloudflare/brain-worker
npm install

# 1. Authenticate (opens browser — must be done by the account owner)
npx wrangler login

# 2. Create the vector index (32 dims = Vectorize minimum; 9 FAS features zero-padded)
npx wrangler vectorize create pbfb-fingerprints --dimensions=32 --metric=cosine

# 3. Secrets (each command prompts for the value — never paste values into files)
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put WORKER_TOKEN   # any long random string; same value goes in Vercel env

# 4. Deploy
npx wrangler deploy
```

Then add to Vercel env (`vercel env add`): `BRAIN_WORKER_URL` (the workers.dev URL)
and `BRAIN_WORKER_TOKEN` (same value as WORKER_TOKEN) so the Next.js API can proxy to it.

## Endpoints

All require the `x-worker-token` header.

| Route | Method | Purpose |
|---|---|---|
| `/ingest` | POST | Sync latest 1000 `pbfb_uc_events` (n_before=1) from Supabase into Vectorize |
| `/similar` | POST | `{ features, topK? }` → nearest historical events + neighbor hit rate |
| `/narrate` | GET | Llama 3.1 8B three-sentence summary of the brain state |

Cron (Mon–Fri 19:00 IST) runs `/ingest` automatically.

## Free-tier budget

- Workers: 100k req/day — usage is a handful/day
- Vectorize: 30k queried vectors/mo, 5M stored dims — 32-dim vectors ≈ 156k events capacity
- Workers AI: 10k neurons/day — one narration/day is a rounding error
