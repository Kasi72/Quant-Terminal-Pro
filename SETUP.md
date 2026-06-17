# Stock Momentum Screener — Setup Guide

## 1. Create Supabase project

1. Go to https://supabase.com → New Project
2. Note your **Project URL** and **anon key** (Settings → API)
3. Also copy the **service_role key** (keep secret)

## 2. Run the database migration

In the Supabase dashboard → **SQL Editor**, paste and run:

```
supabase/migrations/001_init.sql
```

This creates `screening_sessions` and `screening_results` tables with RLS policies.

## 3. Deploy the Edge Function

Install Supabase CLI if needed:
```
npm install -g supabase
```

Login and link your project:
```
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy the function:
```
supabase functions deploy screen-stocks
```

The function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically from
Supabase's built-in environment — no extra secrets needed for the function itself.

## 4. Configure environment variables

Copy the example file:
```
cp .env.local.example .env.local
```

Fill in your values:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## 5. Run locally

```
node "C:\Program Files (x86)\Nodist\npmv\10.2.3\bin\npm-cli.js" run dev
# or if npm works normally:
npm run dev
```

Open http://localhost:3000

## 6. Deploy to Vercel

1. Push this folder to a GitHub repo
2. Go to https://vercel.com → Import repository
3. Add the 3 environment variables from step 4
4. Deploy → done

## Symbol format

Yahoo Finance ticker format:
- NSE stocks: `RELIANCE.NS`, `TCS.NS`, `INFY.NS`
- BSE stocks: `RELIANCE.BO`
- US stocks: `AAPL`, `MSFT`
- Create a CSV with header `Symbol` and one ticker per row

## Cluster colour key

| Colour | Meaning |
|--------|---------|
| 🟡 Gold | All 4 clusters passed — highest conviction |
| 🟠 Orange | 3 clusters passed |
| 🩵 Teal | 2 clusters passed |
| 🔵 Blue | 1 cluster passed |
| Grey | 0 clusters passed |
