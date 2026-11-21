# DEAL001 — Solana Cat Bonds

This folder holds the Solana rewrite of the RHODEX catastrophe bond contracts from `DEAL 000/src/catbond/` (`CatBond.sol`, `TriggerBase.sol`, `ITrigger.sol`). It is a single Anchor 1.2 program, `cat_bond`, that keeps the EVM version's economics: same lifecycle, fee, coupon vesting, refund and trigger rules. The design is adapted to Solana's account model.

## Layout

```
DEAL001/
├── Anchor.toml
├── Cargo.toml                         workspace
└── programs/cat_bond/src/
    ├── lib.rs                         instruction entrypoints
    ├── state.rs                       Bond, Position, Trigger, Report accounts
    ├── math.rs                        fee / coupon / refund math (+ unit tests)
    ├── error.rs, events.rs
    └── instructions/
        ├── trigger.rs                 create_trigger, set_reporter, post_report
        ├── setup.rs                   create_bond, fund_coupon_budget, set_verified
        ├── subscription.rs            deposit, close_subscription
        ├── payout.rs                  claim_coupon, withdraw_principal
        ├── resolution.rs              check_trigger, mark_matured, settle
        └── shared.rs                  trigger evaluation, vault transfers
```

## EVM → Solana mapping

| DEAL 000 (Solidity) | DEAL001 (Anchor) |
|---|---|
| `CatBond` contract, one per deal | `Bond` PDA: `["bond", sponsor, bond_id]` |
| Constructor | `create_bond`, signed by the sponsor (who posts the deal in the UI) |
| USDC held by the contract | `vault` token account PDA `["vault", bond]`, owned by the bond PDA |
| `principalOf` / `alreadyClaimed` / `principalWithdrawn` / `investors[]` | `Position` PDA per investor: `["position", bond, investor]` |
| `TriggerBase` contract | `Trigger` PDA: `["trigger", owner, trigger_id]` |
| `reports[]` array | One `Report` PDA per entry `["report", trigger, index]`, plus `trigger.latest` |
| `ITrigger` conformance probe (`ZeroTrigger`, `InvalidTrigger`) | `Account<Trigger>`: Anchor checks the program owner and discriminator |
| `onlySponsor` / `onlyCompanyWallet` | `has_one = … @ NotSponsor / NotCompanyWallet` + `Signer` |
| `nonReentrant` | Not needed. Solana blocks re-entrancy into the calling program, and state is written before the outgoing CPI |
| `block.timestamp` | `Clock::get()?.unix_timestamp` (i64 seconds) |
| uint256 math | u64 amounts, u128 intermediates, checked arithmetic |
| `keccak256(endpoint)` on-chain | `endpoint_hash` computed off-chain (sha256 of the URL) and passed in |

## Deliberate differences from DEAL 000

- **`bond_id` seed.** PDA seeds are capped at 32 bytes, so the bond address is derived from a 32-byte `bond_id`. The UI should pass `sha256(dealId)`. The readable `deal_id` string is still stored on the bond.
- **Trigger value / threshold are u128.** The UI scales the trigger level by 1e9, which would overflow u64 above ~$18.4B.
- **Input validation added** at `create_bond`: coverage > 0, 0 < min_investment ≤ coverage, durations > 0 (this also guards the vesting division), coupon ≤ 100%, company wallet ≠ sponsor, string/vec length limits, region pct ≤ 100.
- **Classic SPL Token only.** Token-2022 mints with transfer fees would leave the vault short, and both USDC and our RDX test mint are classic SPL Token.
- **Payouts go to the investor's own token account.** `investor_token` must be owned by the signing investor.
- **Triggers live in this program.** EVM bonds could point at any contract implementing `ITrigger`. Here a bond must reference a `Trigger` account owned by `cat_bond`. Pointing at external oracle programs would need a shared account layout or a CPI interface, which is future work.

## Build & test

The math unit tests run on the host with plain cargo:

```bash
cargo test            # 7 tests: fees, coupon budget, refund, vesting caps
```

Full builds need the Solana + Anchor toolchains (installed 2026-11-20: Solana CLI 4.1.2 via avm, Anchor CLI 1.2.2):

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"     # Solana CLI
cargo install avm --git https://github.com/solana-foundation/anchor --locked
avm install 1.2.2 && avm use 1.2.2
anchor build && anchor keys sync && anchor build                  # real program ID
```

## Tests

```bash
cd DEAL001
anchor build                    # tests load target/deploy/cat_bond.so
cargo test                      # 32 tests, < 1 s
npx tsx scripts/e2e-ui-core.ts  # with `npm run localnet` up: the UI's own Solana tx code, end to end
```

- **`cargo test`** runs the math unit tests plus LiteSVM integration tests (`programs/cat_bond/tests/`) against the real SBF build:
  - **`lifecycle.rs`:** maturity, trigger-fired, exact-threshold, undersubscription refund, repeat deposits and the verification stamp, with every token movement checked to the base unit.
  - **`rejections.rs`:** every guard, each asserted against its exact error code: wrong signers, out-of-order steps, minimum/partial fills, missing/pre-commencement/below-threshold/stale reports, and redirected payouts or a fake vault.
- **`e2e-ui-core.ts`** imports `ui/src/chains/solana/core.js` (the builders and send pipeline the pages use) and runs two real deals on the local validator, including error-name decoding from simulation.
- **Toolchain:** LiteSVM 0.18 needs Rust ≥ 1.97.1, so `rust-toolchain.toml` pins Rust 1.100.0 *for this folder only*. rustup installs it on first use, and your global default is untouched.

### Coupon after maturity (fixed on both chains, 2026-11-21)

Coupon unclaimed when the company calls `markMatured()` / `mark_matured` used to be stranded on EVM: `claimCoupon()` rejected Matured and `withdrawPrincipal()` paid principal only. Now, on both chains:

- **`withdraw_principal` / `withdrawPrincipal()`** pays principal **plus** any unclaimed coupon in one transfer (one click on the Deal page).
- **`claim_coupon` / `claimCoupon()`** also works in Matured, for investors who want the coupon on its own first. Vesting still stops at maturity, so a late claim never pays more than the full coupon.

Regression tests: `test_ClaimCoupon_AfterMarkMatured`, `test_WithdrawPrincipal_PaysUnclaimedCoupon`, `test_WithdrawPrincipal_PaysRemainingCoupon` (Foundry; all fail on the old contract) and `withdraw_sweeps_remaining_coupon_with_principal` + the happy path (LiteSVM). Bonds already deployed from the old `CatBond.sol` keep the old behaviour.

### Coupon after a trigger (both chains, 2026-11-21)

When the trigger fires, principal goes to the sponsor, and each investor can claim their **full** coupon at once, not just the part vested up to settlement. The sponsor prepaid the full-term coupon for the cover, and before this the unvested part had no exit and sat in the vault forever. Now the vault empties after a trigger too. Tests: `test_TriggerPath`, `test_TriggerPath_ClaimsRestAfterPartialClaim` (Foundry), `trigger_fired_pays_sponsor_and_full_coupon_to_investors` (LiteSVM), Deal B in `e2e-ui-core.ts`.

## Local environment (Solana counterpart of DEAL 000's `run.sh`)

```bash
cd DEAL001
npm install            # once
npm run codegen        # after every `anchor build`: regenerates the typed @solana/kit client
npm run localnet       # fresh validator + RDX mint + 2 triggers + test bond + funded wallets
npm run localnet -- quick   # same, with a 1-min subscription / 5-min term
```

`npm run localnet` mirrors DEAL 000's test deal: the same product, terms and seller (Raydion, $500k coverage, 8% coupon, $370B economic-loss trigger). It writes:

- `ui/src/chains/solana/localnet.json`: public addresses. The UI picks it up automatically, so paste the printed bond address into `/deal`.
- `.localnet/wallets.txt`: company / sponsor / investor secret keys to import into a browser wallet. These are local test keys only. The wallet keypairs persist across runs (`.localnet/keys/`); the mint, triggers and bond are recreated every run.

The generated client is written to both `clients/js/generated/` (scripts) and `ui/src/chains/solana/generated/` (UI), so each resolves `@solana/kit` from its own `node_modules`. Never edit either by hand.

## Bond store (Supabase) and trigger reporting

Every `rpos` row records its chain: `network` (CAIP-2; local runs get a per-run id from the genesis / block-0 hash) and `environment` (`local` | `testnet` | `mainnet`). Clear throwaway local deals with `delete from rpos where environment = 'local'`; `DEAL 000/run.sh` clears earlier anvil runs' rows itself.

```bash
npx tsx scripts/e2e-bond-store.ts           # localnet + `python3 api/server.py` up: record → bond → link → read back
python3 ../api/report_trigger.py <trigger>  # posts the monitor's latest value; Solana addresses go through scripts/trigger-cli.ts
```

`report_trigger.py` signs Solana reports with `.localnet/keys/company.json` by default (`--keypair` to override). If `.localnet/test-wallets.json` made your own wallet the reporter, that key is the only one allowed to post (`NotReporter` otherwise).

## Devnet (Phase F)

```bash
npm run devnet    # deploy/upgrade cat_bond on devnet, then canonical triggers + a small test bond
```

- **SOL:** the deployer (`.devnet/keys/deployer.json`, gitignored) needs ~4 SOL. The devnet RPC faucet is closed, so fund it at https://faucet.solana.com. The script prints the address and stops until it's funded.
- **Upgrade authority:** that deployer key. Back it up: losing it means the devnet program can never be upgraded.
- **USDC:** the test bond uses Circle devnet USDC (`4zMM…ncDU`), $10 coverage and a $0.80 coupon budget, with a 1-hour term. Fund the sponsor and an investor at https://faucet.circle.com (Solana Devnet). Devnet keys to import into a browser wallet are in `.devnet/wallets.txt`.
- **Outputs:** `ui/src/chains/solana/devnet.json` (committed; the UI registry reads its triggers / company wallet / bonds).

## TODO

- [x] Install the toolchain, `anchor build`, `anchor keys sync` → program ID `3UQzswu1vGu8DoGAttWtWRm3zFvCSvreoG7HDohTqxAj`
- [x] LiteSVM integration tests (lifecycle + rejections, 24 tests; not a 1:1 port of the ~70 Foundry tests)
- [x] Local deal setup script (equivalent of `DEAL 000/script/Setup.s.sol` + `run.sh`): `npm run localnet`
- [x] UI: Solana wallet + writes beside the EVM path (multi-chain plan phases 0–D)
- [x] Coupon after maturity: claim in Matured + withdraw sweeps unclaimed coupon, both chains
- [x] Coupon after a trigger: investors claim the full coupon, both chains
- [ ] Phase F: fund the devnet deployer, `npm run devnet`, then one lifecycle with Circle devnet USDC
- [x] Phase E: `network` / `environment` on `rpos`, bonds.py + server.py + Post deal pass them, Solana report path

## Future ideas

### Embedded wallets (email / Google / passkey login)

Deferred until before public launch (decision 2026-11-20, see `PLAN-multichain-ui.md` §7.4). Worth revisiting.

Today every investor needs a browser wallet extension (MetaMask for EVM, Phantom for Solana) before they can do anything. That is a big hurdle for cat bond investors coming from traditional insurance. Embedded wallet services such as **Privy** and **Dynamic** remove that step:

- **Normal sign-in.** Users log in with email, Google or a passkey, like any website.
- **Wallets created for them.** One login can hold both an EVM address and a Solana address, which suits RHODEX being multi-chain.
- **Split keys.** The private key is split between the user's device and the provider, so neither RHODEX nor the provider holds the full key alone. Users can export it later to take full control.
- **Existing crypto users** can still connect MetaMask or Phantom from the same login screen.
- **Fees can be sponsored**, so investors never need SOL or ETH just to deposit USDC.
- **The login could map to the Supabase user record**, which also helps with KYC later.

**Downsides:** it's a paid service once past the free tier; it adds a vendor dependency (an outage blocks embedded-wallet users from signing); counsel should confirm RHODEX has no custody role; and the SDK owns part of the wallet layer.

**How it would fit:** the multi-chain UI plan routes every page through a `useWallet` hook, so a provider can be added behind that hook later without touching page code.
