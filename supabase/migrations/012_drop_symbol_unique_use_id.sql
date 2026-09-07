-- Allow the same symbol to appear multiple times (repeat setups at different entry dates).
-- The row's UUID primary key (id) becomes the sole deduplication key for upserts.

drop index if exists public.tracked_trades_user_symbol_uidx;

-- Non-unique index so symbol lookups stay fast
create index if not exists tracked_trades_user_symbol_idx
  on public.tracked_trades (user_id, symbol);

create index if not exists tracked_trades_user_entry_date_idx
  on public.tracked_trades (user_id, entry_date);
