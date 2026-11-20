# Plan — Multi-chain UI (EVM + Solana)

**Status:** draft for review, 2026-11-20
**Goal:** the UI runs DEAL 000 (EVM) and DEAL001 (Solana) bonds side by side. Nothing gets ripped out. Each page works against a chain-neutral bond interface, and the chain is chosen per bond.

Edit answers straight into §7. Each question has my recommended default marked **(rec)**.

---

## 1. Where the UI touches the chain today

All chain code is wagmi/viem, called directly from four files:

| File | What it does on-chain |
|---|---|
| `ui/src/main.jsx`, `ui/src/lib/wagmi.js` | `WagmiProvider`; chains anvil/Sepolia/Base Sepolia/Arb Sepolia; injected wallet only |
| `pages/DealPage.jsx` (1072 lines) | reads ~20 bond getters; `approve`, `deposit`, `claimCoupon`, `withdrawPrincipal`, `closeSubscription`, `checkTrigger` |
| `pages/AdminPage.jsx` (1090 lines) | deploys trigger + bond; `fundCouponBudget`, `settle`, `markMatured`, `postReport`, trigger reads |
| `components/build-bond/ReviewSection.jsx` | "Post deal": creates the Supabase record, deploys CatBond, links the address back |
| `components/build-bond/LiveBondsMap.jsx` | batch-reads bond data for the map |
| `constants/abis.js` | ABIs/bytecode, `RHODEX_COMPANY_WALLET`, `CANONICAL_TRIGGERS`, USDC/RDX addresses, all EVM hex |

Off the frontend: `api/bonds.py` stores `contract_address` / `trigger_address` (unique, no chain column), and `api/report_trigger.py` / `deploy_deal.py` use `cast` (EVM only).

The main problem is that the pages call `useReadContract({ functionName: 'principalOf' })` themselves, so the EVM ABI is baked into the page code. To make the UI multi-chain, that layer has to move out of the pages.

## 2. Architecture — one bond interface, two adapters

```
pages / components
      │   useBond(ref), useBondActions(ref), useWallet(family)
      ▼
ui/src/chains/
  ├── types.js           BondRef, BondView, Status, ActionResult (JSDoc types)
  ├── registry.js        network list: { id, family, label, rpc, usdc, triggers, companyWallet }
  ├── ChainProvider.jsx  mounts BOTH WagmiProvider and the Solana provider
  ├── evm/               adapter wrapping today's wagmi calls (moved, not rewritten)
  └── solana/            adapter over the Codama-generated cat_bond client
```

**Both wallet stacks are always mounted.** A user can connect MetaMask and Phantom at the same time. Each bond carries its own network, so a page only uses the wallet for that bond's family.

### 2.1 Normalised types (shared by both adapters)

```js
BondRef  = { family: 'evm'|'solana', network: CAIP-2 id (see §2.5), address: string }
BondView = {
  ref, status: 'funding'|'subscription'|'active'|'matured'|'triggered',
  sponsor, companyWallet, trigger, mint,            // strings (hex or base58)
  threshold, couponRateBps, coverageAmount, minInvestment,
  requiredCouponBudget, totalDeposited,             // bigint, base units
  subscriptionEnd, activeStart, maturity, settlementTime,  // number, unix seconds
  sellerName, dealId, verified, exposure: [{region, pct}],
  lastCheck: { value, reportedAt, triggered, checkedAt, checkedBy },
}
Position = { principal, claimed, withdrawn }        // for the connected wallet
TriggerView = { owner, reporter, productId, version, valuePath, units, maxReportAge, reportCount, latest }
```

Both contracts already have the same fields, so mapping is mechanical. **As built (Phase A):** integers stay `bigint` on both chains (viem and Kit both decode to bigint, and `lib/utils.js` formatters already take it), and `status` is the shared 0–4 index (`STATUS` in `chains/types.js`) rather than a string, so existing `statusLabel()` / colour tables work unchanged. Canonical definitions are the JSDoc types in `ui/src/chains/types.js`.

### 2.2 Adapter interface

```js
adapter.readBond(ref)                    → BondView
adapter.readPosition(ref, owner)         → Position
adapter.readTrigger(network, address)    → TriggerView
adapter.tokenBalance(network, mint, owner)

// Writes return a list of steps so the UI can render "Approve → Deposit" on
// EVM and a single "Deposit" step on Solana (SPL needs no approve).
adapter.plan.deposit(ref, amount, maxAccepted, owner) → Step[]
adapter.plan.fundCouponBudget(ref)        adapter.plan.closeSubscription(ref)
adapter.plan.claimCoupon(ref)             adapter.plan.withdrawPrincipal(ref)
adapter.plan.markMatured(ref)             adapter.plan.settle(ref)
adapter.plan.checkTrigger(ref)            adapter.plan.setVerified(ref, bool)
adapter.plan.createBond(network, params)  → Step[] ending in { bondAddress }
adapter.plan.postReport(network, trigger, value, monitorRef)
```

React hooks wrap these: `useBond(ref)` and `usePosition(ref)` use react-query, which is already installed, and `useBondActions(ref)` runs a `Step[]` with pending/confirmed/error state per step. The pages then depend only on these hooks.

### 2.3 Solana stack (rec)

- **Client:** run [Codama](https://github.com/codama-idl/codama) on `DEAL001/target/idl/cat_bond.json` to generate a typed `@solana/kit` client into `ui/src/chains/solana/generated/`, hooked into `npm run dev` / `build`. This avoids hand-writing instruction encoding, and the PDA helpers come for free.
- **Wallet:** Anza's `@solana/wallet-adapter` 3.x, which uses Wallet Standard discovery (Phantom, Solflare, Backpack and others) with no per-wallet packages. It requires React 19, hence Phase 0.
- **Token accounts:** use the investor's associated token account (ATA), and create it on the fly if missing as an extra instruction in the same transaction.
- **bond_id:** `sha256(dealId)`, computed in the browser with `crypto.subtle`.

### 2.4 Network picker

The network becomes a property of the bond, not a global setting:
- **Deal Page:** a bond loaded from Supabase or the URL already knows its network (`/deal?network=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1&bond=<base58>`). Pasting a raw address auto-detects the family: `0x…` is EVM, base58 is Solana.
- **Build-a-bond:** a "Chain" choice in Section 03 Review, next to the existing USDC/RDX field. It defaults to Solana (decision §7.6).
- **Admin:** a network dropdown at the top. Deploy and manage then act on that network.

### 2.5 Network IDs — CAIP-2 (decided 2026-11-20)

Every bond row and every `BondRef` names its network with a [CAIP-2](https://chainagnostic.org/CAIPs/caip-2) chain ID, the standard wallets and libraries already use:

| Network | `network` | `environment` |
|---|---|---|
| Ethereum mainnet | `eip155:1` | mainnet |
| Base mainnet | `eip155:8453` | mainnet |
| Base Sepolia | `eip155:84532` | testnet |
| Sepolia | `eip155:11155111` | testnet |
| Arbitrum Sepolia | `eip155:421614` | testnet |
| Solana mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | mainnet |
| Solana devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | testnet |
| anvil (one run) | `eip155:31337:<first 16 hex of block-0 hash>` | local |
| solana-test-validator (one run) | `solana:<first 32 chars of genesis hash>` | local |

(Solana hashes verified with `solana genesis-hash` on 2026-11-20.)

- **Real networks never reset**, so their IDs are fixed and an address is unique within one. The same address on two chains (e.g. one deployer on Base and Ethereum, or the same Solana PDA on devnet and mainnet) is kept apart by the network ID.
- **Local chains reset on every restart** and reuse addresses. Standard CAIP-2 already makes a Solana localnet unique per run, because its ID comes from that run's genesis hash. Anvil's chain ID is always 31337, so we append a short block-0 hash (our own extension, not part of CAIP-2). Anvil's block 0 includes the start time, so it changes per run.
- **Local IDs are computed at runtime.** Adapters read the genesis hash from the RPC on connect. The registry stores the RPC URL and `environment: 'local'` for local networks, and fixed IDs for real ones.
- **`environment` comes from the registry, never typed by hand.** It is stored on each row so that queries can filter on it: hiding testnet deals on production, or clearing local junk (§3).

## 3. Backend / data changes

- **Supabase `rpos`:** add `network text` and `environment text check (environment in ('local','testnet','mainnet'))`, plus an index on `environment`. Swap the unique constraint from `contract_address` to `(network, contract_address)`.
  - **Backfill:** every existing row came from anvil, so set `network = 'eip155:31337:legacy'` and `environment = 'local'`. After that, make both columns `not null`.
  - **Why the per-run ID matters** (found 2026-11-20): anvil always deploys the first CatBond at `0x2279…ebe6`, so `DEAL 000/run.sh` currently fails at the link step with a 409 duplicate key. With §2.5 IDs, each anvil run is its own network and the collision goes away.
  - **Cleaning up local rows:**
    ```sql
    -- all local junk, both chains, every run
    delete from rpos where environment = 'local';
    -- just old anvil runs, keeping the current one
    delete from rpos where network like 'eip155:31337:%' and network <> 'eip155:31337:<current>';
    ```
    `environment = 'local'` is the one reliable handle. A Solana localnet ID looks like any other Solana ID, so a name pattern can't find it. Optional: have `run.sh` and the DEAL001 setup script clear previous runs' local rows on start.
- **`api/bonds.py`:** pass `network` through create/link, and add it to the `/link` payload.
- **Trigger reporting:** `report_trigger.py` posts with `cast`. Add a Solana path that posts `post_report` with the company keypair, using `solders` + `anchorpy` or a small TS script with the generated client. Only the sending step changes; payload building (`build_report_payload`) stays chain-neutral.
- **`CANONICAL_TRIGGERS` / `RHODEX_COMPANY_WALLET` / USDC** move into `chains/registry.js`, keyed by network.

## 4. Prerequisites outside the UI

1. `anchor build` + IDL. This is in progress now.
2. **DEAL001 local setup script**, the counterpart of `Setup.s.sol` + `run.sh`. It starts `solana-test-validator` (or Surfpool), deploys `cat_bond`, creates an RDX SPL mint (6 decimals), creates the two canonical triggers (economic / industry), and funds the company, sponsor and investor keypairs with SOL and RDX. It prints the addresses for `registry.js`.
3. At least the happy-path and trigger-path LiteSVM tests, so we aren't debugging the program through the UI.

## 5. Phases

| # | Work | Done when |
|---|---|---|
| 0 | **React 19 upgrade.** react/react-dom 18.3 → 19.3; `@react-three/fiber` 8 → 9 and `@react-three/drei` 9 → 10 (both require React 19; three 0.168 already satisfies them). wagmi 2, react-query 5, react-router 6 and `@gsap/react` already accept React 19, so they stay. | `npm run build` is clean and every page (`/`, v2 home 3D scenes, `/build`, `/deal`, `/admin`) looks and behaves the same in the browser. |
| A | `chains/` scaffold, types, registry. Move the existing wagmi code into `evm/` adapter + hooks. Refactor DealPage → hooks. | The EVM app behaves identically; no Solana yet. |
| B | Same refactor for AdminPage, ReviewSection, LiveBondsMap. | No page imports `wagmi` directly. |
| C | DEAL001 setup script + Codama client + Solana provider + `solana/` reads. | DealPage shows a localnet Solana bond read-only. |
| D | Solana writes: deposit, claim, withdraw, close, check trigger; then admin fund/settle/mature/report; then Post deal. | Full lifecycle on localnet from the UI. |
| E | Supabase `network` column + bonds.py + Solana report path. | A Solana deal round-trips through Supabase like the EVM ones. |
| F | Devnet deploy, registry entries (Circle devnet USDC + devnet triggers), small-terms test bond funded from the Circle faucet. | Shareable devnet demo; one full lifecycle run with real devnet USDC. |

Phases A–B are pure refactors and ship value on their own: the pages get much smaller and EVM behaviour doesn't change. That is also the riskiest part for regressions, so I'd verify each page by hand in the browser against anvil before moving on.

## 6. Risks

- **DealPage/AdminPage are ~1k lines each** with hooks interleaved through the JSX. The refactor should move logic without changing markup, which keeps the lapis/workshop design untouched.
- **Two wallet connect buttons** can confuse users. Show only the wallet for the bond's family on Deal/Build pages, and both on Admin.
- **Bundle size:** the Solana libraries add weight. Lazy-load `chains/solana/` (dynamic import) so EVM-only visitors don't pay for it.
- **Address formats in Supabase** (hex vs base58) are fine as text, but any code that lower-cases addresses must skip that for Solana, because base58 is case-sensitive.

## 7. Decisions (answered 2026-11-20)

1. **Networks:** localnet + devnet only for now. ✅
2. **Collateral:** both. RDX SPL mint on localnet; **Circle devnet USDC on devnet** (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, verified: classic SPL Token, 6 decimals, so the program accepts it unchanged). ✅
   - ⚠️ The Circle faucet (faucet.circle.com → Solana Devnet) only hands out small amounts per request. The devnet test bond needs tiny terms, e.g. $20 coverage and $2 minimum investment. The program has no minimums, but Build-a-bond enforces a **$1M minimum raise** in the UI, so devnet testing goes through Admin deploy or needs a devnet-only bypass for that check.
3. **Wallet library:** upgrade the UI to **React 19** and use Anza's new `@solana/wallet-adapter` (3.x: Wallet Standard discovery, Kit-native, needs React ^19.3.1). This becomes new **Phase 0**, see §5. ✅
4. **Embedded / social-login wallets:** not now. Build on standard wallets and revisit before public launch. The idea is recorded under "Future ideas" in `DEAL001/README.md`. The §2 adapter layer keeps the door open: a provider would plug in behind `useWallet` without page changes. ✅
5. **Company wallet:** one plain keypair for localnet + devnet. ✅
6. **Default chain in Build-a-bond:** Solana. ✅
7. **Order:** refactor first (Phases A–B), then Solana. ✅
