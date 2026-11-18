-- NatCat loss reports: replaces Bubble's RHODEX-NATCAT-LOSS / latest-report
-- workflows. One row per published report (year + period), with a free-form
-- metadata column for extra report detail. NATCAT was empty when this ran
-- (only id/created_at).

alter table public."NATCAT" rename to natcat;

alter table public.natcat
  add column year            smallint not null check (year between 1900 and 2200),
  add column period          text     not null check (period in ('Q1', 'Q2', 'Q3', 'FY')),
  -- Quarterly figures are cumulative year-to-date, as published.
  add column economic_loss_b numeric  check (economic_loss_b >= 0),   -- $B
  add column industry_loss_b numeric  check (industry_loss_b >= 0),   -- $B (insured)
  add column gap_b           numeric  generated always as (economic_loss_b - industry_loss_b) stored,
  add column source_url      text,
  add column as_of           date,                                     -- publication date of the source
  -- Extra report detail, e.g.
  --   {"regional_distribution": {"US": {"economic_loss_b": 80, "industry_loss_b": 30}, ...}}
  add column metadata        jsonb    not null default '{}'::jsonb
                                      check (jsonb_typeof(metadata) = 'object'),
  add column period_end      date     generated always as (
                               make_date(year::int,
                                         case period when 'Q1' then 3 when 'Q2' then 6 when 'Q3' then 9 else 12 end,
                                         case period when 'Q1' then 31 when 'Q2' then 30 when 'Q3' then 30 else 31 end)
                             ) stored,
  add column updated_at      timestamptz not null default now(),
  add constraint natcat_year_period_key unique (year, period),
  add constraint natcat_has_a_figure check (economic_loss_b is not null or industry_loss_b is not null);

create index natcat_period_end_idx on public.natcat (period_end desc);

create trigger natcat_set_updated_at
before update on public.natcat
for each row execute function public.set_updated_at();   -- defined in the rpos migration

-- What triggers read. Same semantics as Bubble's latest-report + the v2
-- product's fallback chain: take the most recent year on file, and for each
-- metric the latest period in that year that actually has a figure
-- (FY total -> Q3 -> Q2 -> Q1). Metrics resolve independently, because a
-- period can publish one figure without the other (e.g. 2023 Q3).
-- security_invoker: the view runs with the caller's rights, so RLS on
-- natcat still applies.
create view public.natcat_latest
with (security_invoker = on) as
with latest_year as (
  select max(year) as year from public.natcat
),
econ as (
  select n.period, n.economic_loss_b, n.source_url, n.as_of
  from public.natcat n, latest_year y
  where n.year = y.year and n.economic_loss_b is not null
  order by n.period_end desc
  limit 1
),
ind as (
  select n.period, n.industry_loss_b, n.source_url, n.as_of
  from public.natcat n, latest_year y
  where n.year = y.year and n.industry_loss_b is not null
  order by n.period_end desc
  limit 1
),
newest as (
  select n.period, n.metadata
  from public.natcat n, latest_year y
  where n.year = y.year
  order by n.period_end desc
  limit 1
)
select
  y.year,
  econ.economic_loss_b,
  econ.period     as economic_period,
  econ.source_url as economic_source_url,
  econ.as_of      as economic_as_of,
  ind.industry_loss_b,
  ind.period      as industry_period,
  ind.source_url  as industry_source_url,
  ind.as_of       as industry_as_of,
  newest.period   as latest_period,
  newest.metadata as latest_metadata
from latest_year y
left join econ   on true
left join ind    on true
left join newest on true
where y.year is not null;
