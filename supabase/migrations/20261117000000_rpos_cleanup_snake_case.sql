-- RPOs cleanup: snake_case names, storage paths for files, missing Bubble
-- fields, guardrails. Written while the table was empty (2026-11-17).

alter table public."RPOs" rename to rpos;

alter table public.rpos rename column "contract-address" to contract_address;
alter table public.rpos rename column "status-triggered" to status_triggered;
alter table public.rpos rename column "product-id"       to product_id;
alter table public.rpos rename column "desc"             to description;

-- Files move to Supabase Storage; rows hold the object path.
alter table public.rpos drop column "loss-history";
alter table public.rpos drop column "SOV";
alter table public.rpos add column loss_history_path text;
alter table public.rpos add column sov_path text;

-- Missing fields from the Bubble model.
alter table public.rpos add column product_version integer;
alter table public.rpos add column trigger_type text;   -- e.g. 'ILW/econ'; used by list-by-type
alter table public.rpos add column updated_at timestamptz not null default now();

-- Guardrails.
alter table public.rpos alter column status_triggered set not null;
alter table public.rpos add constraint rpos_status_triggered_check check (status_triggered in (0, 1, 2));
alter table public.rpos add constraint rpos_contract_address_key unique (contract_address);
alter table public.rpos add constraint rpos_value_nonnegative check (value >= 0);

create index rpos_trigger_type_idx on public.rpos (trigger_type);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger rpos_set_updated_at
before update on public.rpos
for each row execute function public.set_updated_at();

-- Private bucket for loss-history / SOV documents (server-side access only).
insert into storage.buckets (id, name, public)
values ('rpo-documents', 'rpo-documents', false)
on conflict (id) do nothing;
