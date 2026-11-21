-- rpos: which chain a bond lives on (DEAL001/PLAN-multichain-ui.md §2.5, §3).
--
-- network      CAIP-2 chain id, e.g. 'eip155:84532', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'.
--              Local chains carry a per-run id: anvil 'eip155:31337:<16 hex of block-0 hash>',
--              solana-test-validator 'solana:<first 32 chars of genesis hash>'.
-- environment  'local' | 'testnet' | 'mainnet', copied from the UI's chains/registry.js
--              (never typed by hand). `delete from rpos where environment = 'local'`
--              clears every throwaway local deal on both chains.
--
-- Contract addresses are only unique within one network (anvil reuses
-- 0x2279…ebe6 every run, which made DEAL 000/run.sh fail its link step with a
-- 409), so the unique key becomes (network, contract_address).

alter table public.rpos add column network text;
alter table public.rpos add column environment text;

-- Every row so far came from anvil runs whose block-0 hash wasn't recorded.
update public.rpos set network = 'eip155:31337:legacy', environment = 'local'
where network is null;

alter table public.rpos alter column network set not null;
alter table public.rpos alter column environment set not null;
alter table public.rpos add constraint rpos_environment_check
  check (environment in ('local', 'testnet', 'mainnet'));

alter table public.rpos drop constraint rpos_contract_address_key;
alter table public.rpos add constraint rpos_network_contract_address_key
  unique (network, contract_address);

create index rpos_environment_idx on public.rpos (environment);
