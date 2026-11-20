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

## TODO

- [x] Install the toolchain, `anchor build`, `anchor keys sync` → program ID `3UQzswu1vGu8DoGAttWtWRm3zFvCSvreoG7HDohTqxAj`
- [ ] Port the Foundry suite (`DEAL 000/test/CatBond.t.sol`, ~70 tests) to LiteSVM integration tests
- [ ] Local deal setup script (equivalent of `DEAL 000/script/Setup.s.sol` + `run.sh`): RDX mint, trigger, bond, funded wallets
- [ ] UI: swap wagmi deploy/calls for a Solana wallet adapter + generated client in `ui/`

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
