# On-Chain Catastrophe Bond — Foundry Project

A fixed-pricing, single-risk-layer catastrophe bond in Solidity. A sponsor gets protection against a defined event; investors provide principal in exchange for a coupon stream. If the trigger fires, investors lose their principal and the sponsor receives it. If not, investors receive their coupon over the term and their principal back at maturity.

---

## Project layout

```
contracts/
  ITrigger.sol      — one-function interface every trigger must implement
  TriggerBase.sol   — abstract reference trigger; owner can manually flip it
  CatBond.sol       — main contract: holds funds, manages the full lifecycle

test/
  CatBond.t.sol     — Foundry test suite (unit + fuzz, 20 tests)
  CatBondHarness.sol — thin CatBond subclass with a settable mock clock (Remix)
  RemixTest.sol     — self-contained tests for the Remix IDE (no forge-std)

script/
  Deploy.s.sol      — Forge deployment script (reads env vars, broadcasts txs)

lib/
  forge-std/        — Foundry standard library (installed via forge install)
  openzeppelin-contracts/  — OZ contracts (SafeERC20, ReentrancyGuard, etc.)

foundry.toml        — Foundry project configuration
```

---

## Quick-start for new developers

### 1. Prerequisites

Install Foundry (one-time):
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Clone and enter the repo, then restore dependencies:
```bash
forge install
```

### 2. Run the tests

```bash
forge test          # run all 25 tests
forge test -vv      # show pass/fail + logs
forge test -vvvv    # full execution trace (useful for debugging)
forge test --gas-report   # print gas usage per function
forge snapshot      # write a gas snapshot file for CI comparison
```

The test suite covers:
- Happy path (full lifecycle without trigger)
- Trigger path (trigger fires mid-term)
- Fee accounting (exact math for 0.5% origination fee)
- Rejection paths (10 revert-case tests)
- Partial fill / capacity consent logic
- Undersubscription coupon refund
- Linear vesting precision (2-hour term, exact 50%/100% checkpoints)
- **Fuzz tests** — 1 000 random inputs each for coupon cap, fee exactness, and two-claim monotonicity

### 3. Compile only

```bash
forge build
```

Output goes to `out/`. Includes ABI JSON files for each contract.

### 4. Local devnet (Anvil)

```bash
anvil          # starts a local EVM at http://127.0.0.1:8545 with funded test accounts
```

### 5. Deploy to a network

Copy `.env.example` to `.env` and fill in the required variables, then:

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

The script prints the deployed addresses and `requiredCouponBudget` to the console.

Required env vars:
| Var | Description |
|---|---|
| `SPONSOR` | Wallet that funds the bond and receives principal if triggered |
| `COMPANY_WALLET` | Wallet that can call `settle()` and `markMatured()` |
| `USDC_ADDRESS` | USDC contract on the target network |
| `RPC_URL` | JSON-RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | Private key of the deploying account |

Optional overrides (defaults match the $75k demo bond):
| Var | Default |
|---|---|
| `COUPON_BPS` | 500 (5% p.a.) |
| `COVERAGE_AMOUNT` | 75000000000 ($75k) |
| `MIN_INVESTMENT` | 25000000000 ($25k) |
| `SUBSCRIPTION_SECONDS` | 604800 (7 days) |
| `TERM_SECONDS` | 31536000 (365 days) |

---

## Deployment sequence (step by step)

### Step 1 — Deploy the trigger

The deploy script deploys a `ManualTrigger` (owner can flip it). For a real deal, write a custom trigger extending `TriggerBase` (e.g., reads a Chainlink oracle) and deploy that instead.

See `TriggerBase.sol` for the exact integration point.

### Step 2 — Deploy `CatBond`

The deploy script does this automatically. If deploying manually, the constructor args are:

| Arg | Example |
|---|---|
| `_sponsor` | `0xABC…` |
| `_companyWallet` | `0xDEF…` |
| `_trigger` | address from Step 1 |
| `_usdc` | USDC contract address |
| `_couponRateBps` | `500` (5%) |
| `_coverageAmount` | `75000000000` ($75k, 6-decimal USDC) |
| `_minInvestment` | `25000000000` ($25k) |
| `_subscriptionDuration` | `604800` (7 days) |
| `_termDuration` | `31536000` (365 days) |

After deployment, read `bond.requiredCouponBudget()` — the sponsor needs to approve exactly this plus 0.5%.

### Step 3 — Sponsor funds

```
totalApproval = requiredCouponBudget * 1005 / 1000
USDC.approve(bondAddress, totalApproval)
bond.fundCouponBudget()
```

### Step 4 — Investors deposit

```
USDC.approve(bondAddress, principal * 1005 / 1000)
bond.deposit(principal, maxAccepted)
```

`maxAccepted` is the largest accepted amount the investor will tolerate. If the bond is nearly full and the investor's accepted amount would exceed `maxAccepted`, the call reverts. Pass `maxAccepted = principal` for a full-fill-or-proportional-fill scenario.

### Step 5 — Close subscription

Anyone can call `bond.closeSubscription()` once `block.timestamp >= subscriptionEnd`. This starts coupon vesting and refunds any unused coupon budget to the sponsor.

### Step 6a — Maturity (no trigger)

1. Wait until `bond.maturity()` has passed.
2. Company wallet calls `bond.markMatured()` (human checkpoint — see contract comment).
3. Investors call `bond.withdrawPrincipal()`.
4. At any time during Active, investors call `bond.claimCoupon()` to collect vested coupon.

### Step 6b — Trigger fires

1. Trigger oracle fires (or company wallet calls `trigger.setTriggered(true)` for manual trigger).
2. Call `bond.pingTrigger()` to emit an on-chain `TriggerDetected` event.
3. Company wallet calls `bond.settle()`. All investor principal transfers to sponsor.
4. Investors call `bond.claimCoupon()` to collect coupon vested up to `settlementTime`.

---

## Coupon vesting formula

```
totalCoupon = principal × couponRateBps / 10,000 × termDuration / 365 days
vested      = totalCoupon × elapsed / termDuration
claimable   = vested − alreadyClaimed
```

`elapsed` is capped at `maturity` (or `settlementTime` if triggered). Calling `claimCoupon()` twice in the same block always reverts on the second call — `vested` doesn't change within a block.

---

## Foundry cheatcodes used in tests (reference for new devs)

| Cheatcode | What it does |
|---|---|
| `vm.prank(addr)` | Next call is sent from `addr` |
| `vm.startPrank(addr)` / `vm.stopPrank()` | All calls in the block are from `addr` |
| `vm.warp(ts)` | Set `block.timestamp` to `ts` |
| `vm.expectRevert(selector)` | Assert next call reverts with this 4-byte selector |
| `vm.expectEmit(...)` | Assert next call emits a specific event |
| `bound(x, min, max)` | Clamp a fuzz input to a valid range |
| `assertEq(a, b)` | Assert equality (prints diff on failure) |
| `assertGt(a, b)` | Assert `a > b` |

---

## Writing a new test (template)

```solidity
// test/MyFeature.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CatBond.sol";
import "../contracts/TriggerBase.sol";

// Inline mock ERC-20 so the test is self-contained
contract MockUSDC { /* ... see CatBond.t.sol ... */ }
contract TestTrigger is TriggerBase { constructor(address o) TriggerBase(o) {} }

contract MyFeatureTest is Test {
    // ── actors
    address sponsor       = address(0xA1);
    address companyWallet = address(0xA2);
    address investor1     = address(0xB1);

    // ── bond params — use uint256 for constants used in formulas
    uint256 constant COUPON_BPS    = 500;
    uint256 constant COVERAGE      = 75_000 * 1e6;
    uint256 constant MIN_INVEST    = 25_000 * 1e6;
    uint256 constant TERM_DURATION = 365 days;

    MockUSDC    usdc;
    TestTrigger trig;
    CatBond     bond;

    function setUp() public {
        usdc = new MockUSDC();
        trig = new TestTrigger(companyWallet);
        bond = new CatBond(
            sponsor, companyWallet, address(trig), address(usdc),
            uint16(COUPON_BPS), COVERAGE, MIN_INVEST, 7 days, TERM_DURATION
        );
    }

    function test_MyScenario() public {
        // 1. Sponsor funds
        // 2. Investor deposits
        // 3. Time passes (vm.warp)
        // 4. Assert expected state
    }

    // Fuzz test template
    function testFuzz_MyInvariant(uint256 randomInput) public {
        randomInput = bound(randomInput, 1, COVERAGE);
        // ... property that must hold for all valid inputs
    }
}
```

**Key rule:** declare coupon-rate constants as `uint256`, not `uint16`, even though the contract stores them as `uint16`. Solidity 0.8 narrows large literal expressions (like `25_000 * 1e6`) to the type of the constant they're multiplied against, causing a runtime arithmetic panic. Cast to `uint16` only at the constructor call site: `uint16(COUPON_BPS)`.

---

## Running the deploy script on a fork (smoke test)

```bash
anvil --fork-url $RPC_URL &

export SPONSOR=0x...
export COMPANY_WALLET=0x...
export USDC_ADDRESS=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48   # mainnet USDC

forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

(The private key above is Anvil's default account #0 — never use it on mainnet.)

---

## Notes for v2 / Chainlink integration

`TriggerBase.sol` has a comment showing exactly where a Chainlink Data Feed call would go. Replace `setTriggered(true)` with an oracle read:

```solidity
// contracts/FloodTrigger.sol
contract FloodTrigger is TriggerBase {
    AggregatorV3Interface internal _oracle;
    int256 public constant FLOOD_THRESHOLD = 10_000; // units per oracle spec

    constructor(address _owner, address oracleAddress) TriggerBase(_owner) {
        _oracle = AggregatorV3Interface(oracleAddress);
    }

    function isTriggered() external view override returns (bool) {
        (, int256 answer,,,) = _oracle.latestRoundData();
        return answer >= FLOOD_THRESHOLD;
    }
}
```

No changes to `CatBond.sol` are needed — it only calls `trigger.isTriggered()`.

---

## What was done to add Foundry support

Starting from Remix-only Solidity files, the following was added:

1. **`foundry.toml`** — configures `src = "contracts"` (keeps existing directory), remappings for forge-std and OpenZeppelin, Solidity 0.8.20, optimizer on, and fuzz/invariant settings.

2. **`lib/` dependencies** — installed `forge-std` and `openzeppelin-contracts` via `forge install --no-git`.

3. **`script/Deploy.s.sol`** — a Forge Script that deploys `ManualTrigger` + `CatBond`, reads parameters from environment variables, and logs the deployed addresses.

4. **`test/CatBond.t.sol`** — augmented with three fuzz tests:
   - `testFuzz_CouponNeverExceedsCap` — coupon paid can never exceed the theoretical cap
   - `testFuzz_FeeIsExactHalfPercent` — origination fee is always exactly 50 bps
   - `testFuzz_TwoClaimsSumToAtMostFullCoupon` — sequential claims never overpay

5. **Bug fixes in tests:**
   - Changed `uint16 constant COUPON_BPS` to `uint256` in both `CatBond.t.sol` and `RemixTest.sol`. Solidity 0.8 narrows literal expressions to a `uint16` intermediate before multiplying, causing a runtime overflow panic (code `0x11`). Constructor calls now use `uint16(COUPON_BPS)` explicitly.
   - Fixed `test_PartialFill`: the `ExceedsMaxAccepted` revert triggers when `accepted > maxAccepted`. With $10M remaining and the original `maxAccepted = $25M-1`, `accepted ($10M) <= maxAccepted ($25M-1)` — no revert. Fixed by using `maxAccepted = $9M` so `$10M > $9M` triggers the expected revert.

6. **`.gitignore`** — added standard entries for Foundry build artifacts.
