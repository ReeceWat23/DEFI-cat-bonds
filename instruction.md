# Catastrophe Bond — Solidity Build Spec

**For:** Claude Code
**Goal:** Build a working catastrophe bond smart contract system in Solidity, deployable and testable in Remix. Code must be clear, concise, and auditable. Prefer many small files over fewer large ones.

---

## 1. Context

We are building on-chain catastrophe bonds. A sponsor (e.g., a municipality or utility) wants protection against a defined catastrophic event (flood, drought, wildfire, etc.). Investors provide principal in exchange for a coupon stream. If the trigger event occurs and is settled, investors lose their principal and the sponsor receives the funds. If it does not occur, investors receive their coupon over time and their principal back at maturity.

This is a **fixed-pricing, single-risk-layer** structure. One sponsor. One trigger. One coupon rate. Multiple investors.

---

## 2. Architecture

Build the following files. Keep each one small and single-purpose.

```
contracts/
  CatBond.sol         — main contract; holds funds, manages lifecycle
  TriggerBase.sol     — abstract base + example trigger implementation
  ITrigger.sol        — single-function interface for the trigger contract
test/
  CatBond.t.sol       — basic test scaffolding (Remix-compatible)
```

**Why a separate trigger contract:** every deal has a different trigger condition (flood gauge, drought index, wildfire perimeter, etc.). The bond contract should not care what the trigger is — only whether it has fired. Each deal deploys its own trigger contract implementing one function.

Do not add interfaces beyond `ITrigger`. Do not add proxies, upgrade patterns, or factories yet. The user wants to test the core contract in Remix first.

---

## 3. Token & Accounting

- All deposits, coupon payments, and principal returns are in **USDC** (ERC-20, 6 decimals).
- The contract holds zero ETH. All callers pay their own gas natively.
- Use OpenZeppelin's `IERC20` and `SafeERC20` (these are Remix-importable via `@openzeppelin/contracts/...`).
- Use `ReentrancyGuard` on all functions that move USDC out of the contract.

### Origination fee

- A **0.5% origination fee** is charged on every deposit into the contract — both the sponsor's coupon budget funding and every investor deposit.
- The fee is charged **on top** of the deposit amount. If an investor wants $25,000 of principal in the bond, they approve and pay `25,000 * 1.005 = $25,125`. The extra $125 is transferred directly to `companyWallet`. The $25,000 becomes their `principalOf` balance.
- Same for the sponsor: if `requiredCouponBudget` is $500,000, the sponsor approves and pays `500,000 * 1.005 = $502,500`. The contract holds $500,000 for coupon payouts; $2,500 goes to `companyWallet`.
- Fee constant: `uint256 constant ORIGINATION_FEE_BPS = 50;` (50 basis points = 0.5%). Use `10_000` as the denominator.
- Fee calculation: `fee = amount * ORIGINATION_FEE_BPS / 10_000`. Solidity rounds down on integer division; that's fine here.
- The fee transfers happen in the same transaction as the deposit. If the fee transfer fails (e.g., USDC paused), the whole deposit reverts.
- Coupon payouts and principal withdrawals are **not** fee-charged. The fee only applies on the way in.
- Helper function suggestion: `_collectWithFee(address from, uint256 principalAmount)` that pulls `principalAmount + fee` from `from`, sends `fee` to `companyWallet`, and leaves `principalAmount` in the contract. Both `fundCouponBudget` and `deposit` should use this helper so the fee logic lives in one place.

---

## 4. Lifecycle States

The bond progresses through these states. Encode as an `enum Status`:

1. `Funding` — sponsor has deployed but not yet funded.
2. `Subscription` — sponsor has funded the coupon budget; investors can deposit USDC.
3. `Active` — subscription window closed; coupon vesting clock starts; investors can claim vested coupon.
4. `Matured` — maturity timestamp reached without trigger; investors can withdraw principal; sponsor walks away.
5. `Triggered` — trigger has fired AND company wallet has called `settle()`; all remaining investor principal has been transferred to sponsor; investors can still claim coupon vested up to the settlement timestamp.

State transitions are one-way. Document each transition with an event.

---

## 5. Constructor Parameters

The bond is deployed with these immutable parameters:

| Parameter | Type | Notes |
|---|---|---|
| `sponsor` | `address` | Wallet that will fund and (if triggered) receive principal |
| `companyWallet` | `address` | The only address authorized to call `settle()` |
| `trigger` | `address` | Address of the deployed trigger contract |
| `usdc` | `address` | USDC contract address |
| `couponRateBps` | `uint16` | Annualized coupon rate in basis points (e.g., 500 = 5%) |
| `coverageAmount` | `uint256` | Maximum USDC the bond will accept from investors (in 6-decimal units) |
| `minInvestment` | `uint256` | Minimum per-investor deposit; default $25,000 = `25_000 * 1e6` |
| `subscriptionDuration` | `uint256` | Seconds the subscription window stays open after sponsor funds |
| `termDuration` | `uint256` | Seconds from `Active` start to maturity |

Derived:
- `requiredCouponBudget = coverageAmount * couponRateBps * termDuration / (10_000 * 365 days)`
- `subscriptionEnd` is set when sponsor funds (`block.timestamp + subscriptionDuration`).
- `maturity` is set when subscription closes (`block.timestamp + termDuration`).

---

## 6. Function Specifications

### `fundCouponBudget()` — sponsor only
- Callable only by `sponsor`.
- Only valid in `Funding` state.
- Pulls `requiredCouponBudget + fee` USDC from sponsor (requires prior `approve` for that total). The contract retains `requiredCouponBudget`; the fee goes to `companyWallet`. Use `_collectWithFee(sponsor, requiredCouponBudget)`.
- Sets `subscriptionEnd = block.timestamp + subscriptionDuration`.
- Transitions state to `Subscription`.
- Emits `SponsorFunded(uint256 principalAmount, uint256 feeAmount, uint256 subscriptionEnd)`.

### `deposit(uint256 amount, uint256 maxAccepted)` — any wallet
- Only valid in `Subscription` state and before `subscriptionEnd`.
- `amount` and `maxAccepted` refer to **principal amounts** (what becomes the investor's `principalOf` balance). The fee is on top.
- `maxAccepted` is the most principal the investor is willing to have accepted if full capacity isn't available. If they want all-or-nothing, they pass `maxAccepted == amount`.
- Logic:
  - Compute `remaining = coverageAmount - totalDeposited`.
  - Compute `accepted = min(amount, remaining)`.
  - Require `accepted >= minInvestment`.
  - Require `accepted <= maxAccepted`. (Otherwise revert — the investor consented to less than what would be filled.)
  - If this is the investor's first deposit, append them to `investors` array. Otherwise add to their existing balance.
  - Pull `accepted + fee` USDC from caller via `_collectWithFee(msg.sender, accepted)`.
  - Update `totalDeposited`.
- The investor must `approve` for at least `accepted * 1.005` worth of USDC before calling. If they pre-approve based on `amount` but `accepted < amount` (partial fill), no extra approval is needed because the fee scales with `accepted`.
- Emits `Deposited(address investor, uint256 accepted, uint256 feeAmount, uint256 totalDeposited)`.

### `closeSubscription()` — anyone
- Only valid in `Subscription` state and after `subscriptionEnd`.
- Sets `activeStart = block.timestamp`.
- Sets `maturity = block.timestamp + termDuration`.
- If `totalDeposited < coverageAmount`, computes unused coupon and refunds it to sponsor:
  - `unusedCoverage = coverageAmount - totalDeposited`
  - `refund = unusedCoverage * couponRateBps * termDuration / (10_000 * 365 days)`
  - Transfer `refund` USDC to sponsor.
- Transitions state to `Active`.
- Emits `SubscriptionClosed(uint256 totalDeposited, uint256 unusedCouponRefund)`.

### `claimCoupon()` — investor only
- Valid in `Active` or `Triggered` state.
- Computes vested coupon for `msg.sender`:
  - Let `elapsed = min(block.timestamp, vestingEndTime) - activeStart`
    - In `Active`: `vestingEndTime = maturity`
    - In `Triggered`: `vestingEndTime = settlementTime` (snapshotted at settlement)
  - `totalCouponForInvestor = investorPrincipal * couponRateBps * termDuration / (10_000 * 365 days)`
  - `vested = totalCouponForInvestor * elapsed / termDuration`
  - `claimable = vested - alreadyClaimed[msg.sender]`
- Require `claimable > 0`.
- Update `alreadyClaimed[msg.sender] += claimable`.
- Transfer `claimable` USDC to investor.
- Emits `CouponClaimed(address investor, uint256 amount)`.

### `withdrawPrincipal()` — investor only
- Only valid in `Matured` state.
- Requires the company wallet to have called `markMatured()` first to transition to `Matured` once `block.timestamp >= maturity`.
- Transfers the investor's full principal back. Marks them as withdrawn (prevent double-withdraw).
- Emits `PrincipalWithdrawn(address investor, uint256 amount)`.

### `markMatured()` — company wallet only
- Only valid in `Active` state and after `maturity`.
- Requires trigger has NOT fired (`!trigger.isTriggered()`).
- Restricted to `companyWallet`. Rationale: this serves as a "phase settlement review" gate. Even though the conditions are objectively checkable on-chain, requiring the company wallet to call this gives a human review checkpoint before investors can withdraw principal — protecting against edge cases like a trigger oracle that's about to flip true at the boundary of maturity, or a malicious trigger contract. The tradeoff: investors cannot withdraw until the company acts. Document this clearly to investors at onboarding.
- Transitions state to `Matured`.
- Emits `Matured(uint256 timestamp)`.

### `settle()` — company wallet only
- Only valid in `Active` state.
- Requires `trigger.isTriggered() == true`.
- Snapshots `settlementTime = block.timestamp` (used to cap coupon vesting).
- Transfers ALL remaining investor principal (i.e., `totalDeposited` minus any... wait, principal hasn't been touched yet — transfer `totalDeposited`) to sponsor.
- Transitions state to `Triggered`.
- Emits `Settled(uint256 amountToSponsor, uint256 settlementTime)`.

**Note:** After settlement, investors can still call `claimCoupon()` to collect the coupon that vested up to `settlementTime`. This is funded from the sponsor's original coupon budget, which remains in the contract.

### `triggerStatus()` — view, anyone
- Returns `(bool fired, Status currentStatus)`.
- Calls `trigger.isTriggered()` and emits `TriggerDetected(bool fired)` if fired and not yet settled. Useful for off-chain monitoring; off-chain service watches this event and alerts the company wallet.
- **Wait — events can't be emitted from view functions.** Make this two functions: `triggerStatus()` as a pure view returning `(bool, Status)`, AND a separate non-view `pingTrigger()` that anyone can call which emits `TriggerDetected(bool)` if the trigger has fired. The off-chain monitor can call `pingTrigger()` periodically or trigger it from a watched event. Document this clearly in code comments.

---

## 7. The Trigger Contract

### `ITrigger.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITrigger {
    function isTriggered() external view returns (bool);
}
```

### `TriggerBase.sol`

Provide an abstract `TriggerBase` contract implementing `ITrigger` with:
- An `owner` (the company wallet or designated operator).
- A boolean `_triggered` storage variable.
- A `setTriggered(bool)` function callable only by owner — for manual triggers or testing.
- `isTriggered()` returns `_triggered`.

This is the simplest possible trigger and serves as a reference implementation. Real deals would extend it (e.g., a `FloodTrigger` that reads a Chainlink oracle and flips `_triggered` automatically when a threshold is crossed). Do not build the Chainlink integration in this pass — just leave a comment showing where it would plug in.

---

## 8. State Variables Summary

In `CatBond.sol`:

```solidity
// Immutable config
address public immutable sponsor;
address public immutable companyWallet;
ITrigger public immutable trigger;
IERC20 public immutable usdc;
uint16 public immutable couponRateBps;
uint256 public immutable coverageAmount;
uint256 public immutable minInvestment;
uint256 public immutable subscriptionDuration;
uint256 public immutable termDuration;
uint256 public immutable requiredCouponBudget;

// Lifecycle
Status public status;
uint256 public subscriptionEnd;
uint256 public activeStart;
uint256 public maturity;
uint256 public settlementTime;  // set on settle()

// Accounting
uint256 public totalDeposited;
mapping(address => uint256) public principalOf;
mapping(address => uint256) public alreadyClaimed;
mapping(address => bool) public principalWithdrawn;
address[] public investors;
```

The `investors` array is for off-chain enumeration. All actual coupon/principal claims are pull-based (investor calls the function themselves) — the contract never iterates the array. This is critical for gas safety.

---

## 9. Events

Define at minimum:

- `SponsorFunded(uint256 principalAmount, uint256 feeAmount, uint256 subscriptionEnd)`
- `Deposited(address indexed investor, uint256 accepted, uint256 feeAmount, uint256 totalDeposited)`
- `SubscriptionClosed(uint256 totalDeposited, uint256 unusedCouponRefund)`
- `CouponClaimed(address indexed investor, uint256 amount)`
- `PrincipalWithdrawn(address indexed investor, uint256 amount)`
- `Matured(uint256 timestamp)`
- `Settled(uint256 amountToSponsor, uint256 settlementTime)`
- `TriggerDetected(bool fired)`

Note: fee events are bundled into `SponsorFunded` and `Deposited` rather than separate events. This keeps the event log compact and the fee always travels with the context of which deposit it came from.

---

## 10. Modifiers

Use modifiers for repeated access/state checks:

- `onlySponsor`
- `onlyCompanyWallet`
- `inStatus(Status required)`

Keep them short. Don't combine into one mega-modifier — auditors should be able to read each check at a glance.

---

## 11. Math Precision Notes

- USDC has 6 decimals. All amounts in 6-decimal units.
- Coupon rate uses basis points (10000 = 100%). Use `10_000` as the denominator constant.
- Time uses seconds. Use `365 days` (= 31,536,000) as the year denominator. Do not use 360 or 365.25 — keep it simple and document the choice in a comment.
- Always multiply before dividing. Solidity 0.8+ has built-in overflow checks, so don't worry about intermediate overflow on reasonable bond sizes (< $1B USDC). Add a comment noting this assumption.
- Round vested coupon down (Solidity's default integer division). The final claim at maturity will collect any rounding dust because `vested - alreadyClaimed` always equals the full per-investor coupon at `elapsed == termDuration`.

---

## 12. Things NOT to Build

- No KYC. No on-chain identity. No allowlist on investors.
- No interfaces beyond `ITrigger`.
- No factory contract.
- No proxy / upgrade pattern.
- No multiple risk layers / tranches.
- No secondary market / transferability of investor positions. Once you deposit, only the original `msg.sender` can claim coupon or withdraw principal.

---

## 13. Tests

Provide a single `CatBond.t.sol` file with Foundry-style tests, but written so they can also be manually walked through in Remix. Cover at minimum:

1. Happy path: sponsor funds → 3 investors deposit → subscription closes → time passes → each investor claims coupon → maturity → company calls `markMatured()` → each investor withdraws principal. Assert balances at every step, including `companyWallet` USDC balance reflecting all collected fees.
2. Trigger path: same setup, but trigger fires mid-term → company wallet calls `settle()` → sponsor receives all principal → investors claim coupon vested up to settlement time only.
3. Fee accounting:
   - Sponsor funds $500K coupon budget → `companyWallet` receives exactly $2,500 fee, contract holds exactly $500K.
   - Investor deposits $25K principal → `companyWallet` receives $125 fee, investor's `principalOf` is exactly $25K, contract's USDC balance increases by exactly $25K.
   - Cumulative fee math: assert `companyWallet` balance after N deposits equals sum of all fees.
4. Rejection paths:
   - Deposit below `minInvestment` reverts.
   - Deposit when `accepted > maxAccepted` reverts (consent check).
   - Deposit after `subscriptionEnd` reverts.
   - Deposit without sufficient USDC approval (forgot to approve fee on top) reverts.
   - `closeSubscription` before `subscriptionEnd` reverts.
   - `settle()` from non-company wallet reverts.
   - `settle()` when trigger has not fired reverts.
   - `markMatured()` from non-company wallet reverts.
   - `markMatured()` when trigger has fired reverts.
   - `markMatured()` before `maturity` reverts.
   - `claimCoupon()` twice in same block returns zero the second time.
5. Partial fill: $30M coverage, $10M deposited, fourth investor deposits with `amount=$25M, maxAccepted=$25M` → reverts. Same investor retries with `amount=$25M, maxAccepted=$20M` → accepts $20M (the remaining capacity), rejects rest. Confirm the fee charged corresponds to $20M ($100K), not $25M.
6. Undersubscription refund: $50M coverage, only $30M raised → on `closeSubscription`, sponsor receives coupon refund for the $20M shortfall. The refund is the raw coupon amount — no fee is refunded (the fee was earned on the original deposit and stays with the company).

Comment each test with what business rule it's protecting.

---

## 14. Code Style

- Solidity `^0.8.20`.
- `// SPDX-License-Identifier: MIT` at top of every file.
- NatSpec comments on every public/external function.
- One concept per function. If a function is doing two things, split it.
- Prefer named errors (`error InsufficientDeposit();`) over `require` strings — gas-cheaper and cleaner.
- Group state variables by purpose (immutables, lifecycle, accounting) with section comments.
- No magic numbers. Every constant gets a name.

---

## 15. Deliverable

When done, output:

1. All `.sol` files, ready to paste into Remix.
2. A short README explaining the deployment sequence: deploy `TriggerBase` (or custom trigger), deploy `CatBond` with constructor args, sponsor calls `approve` then `fundCouponBudget`, etc.
3. A list of any assumptions you made where the spec was ambiguous, and any pieces you think we should reconsider for v2 (e.g., secondary market, multi-layer tranches, automated Chainlink trigger).

Do not skip the README — it should be readable by someone who has never seen this codebase.