-- Bayesian Beta-Binomial win-rate posteriors per archetype
-- Written by pbfb-brain-worker nightly cron (computeBayesianWR)
create table if not exists archetype_bayes_wr (
  archetype       text primary key,
  prior_alpha     numeric not null,
  prior_beta      numeric not null,
  live_wins       integer not null default 0,
  live_losses     integer not null default 0,
  alpha           numeric not null,
  beta            numeric not null,
  posterior_mean  numeric not null,
  ci_low          numeric not null,
  ci_high         numeric not null,
  updated_at      date not null default current_date
);

-- Read-only from Vercel (anon key); writes from brain-worker (service role)
alter table archetype_bayes_wr enable row level security;

create policy "public read"
  on archetype_bayes_wr for select
  using (true);
