// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained Remix test for CatBond logic.
//
// HOW TO USE:
//   1. In Remix, select "JavaScript VM" (not a forked mainnet) in Deploy & Run.
//   2. Compile all contracts in contracts/ and test/.
//   3. Deploy RemixTest — no constructor args needed.
//   4. Call individual testXxx() functions from the Remix UI.
//      Each function is stateless: it deploys fresh contracts internally.
//      A successful call returns without revert. A failed assertion reverts
//      with a human-readable require() message visible in the Remix console.
//
// No forge-std. No archive node. No historical state queries.
// ─────────────────────────────────────────────────────────────────────────────

import "./CatBondHarness.sol";
import "../contracts/TriggerBase.sol";

// ── Inline mock ERC-20 ────────────────────────────────────────────────────────

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public constant decimals = 6;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockUSDC: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "MockUSDC: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "MockUSDC: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

// ── Manual trigger ────────────────────────────────────────────────────────────

contract ManualTrigger is TriggerBase {
    // lossLimit=1 so report() fires with any real value in tests
    constructor(address _owner) TriggerBase(_owner, 1, 0) {}
}

// ── Investor proxy ────────────────────────────────────────────────────────────
// Gives each simulated investor a distinct address so principalOf[inv] is
// tracked separately. The test contract orchestrates all calls through proxies.

contract InvestorProxy {
    MockUSDC       public usdc;
    CatBondHarness public bond;

    constructor(address _usdc, address _bond) {
        usdc = MockUSDC(_usdc);
        bond = CatBondHarness(_bond);
    }

    /// @notice Approve the bond for principal + fee, then deposit.
    function approveAndDeposit(uint256 principal, uint256 maxAccepted) external {
        uint256 fee = principal * 50 / 10_000;
        usdc.approve(address(bond), principal + fee);
        bond.deposit(principal, maxAccepted);
    }

    function claimCoupon()       external { bond.claimCoupon(); }
    function withdrawPrincipal() external { bond.withdrawPrincipal(); }
    function balance()           external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main test contract
// ─────────────────────────────────────────────────────────────────────────────
// address(this) serves as both sponsor and companyWallet in all tests so the
// test contract can call role-gated functions directly.

contract RemixTest {

    // ── Shared bond parameters ────────────────────────────────────────────────
    // NOTE: uint256 to avoid Solidity 0.8 narrowing large literals to uint16 in math.
    uint256 constant COUPON_BPS    = 500;       // 5% p.a.
    uint256 constant COVERAGE      = 75_000e6;  // $75,000
    uint256 constant MIN_INVEST    = 25_000e6;  // $25,000
    uint256 constant SUB_DURATION  = 7 days;
    uint256 constant TERM_DURATION = 365 days;

    // ── Pure helper ───────────────────────────────────────────────────────────

    function _withFee(uint256 amount) internal pure returns (uint256) {
        return amount + amount * 50 / 10_000;
    }

    // ── Shared setup helpers ──────────────────────────────────────────────────

    function _deploy(
        uint256 coverage,
        uint256 minInvest,
        uint256 subDuration,
        uint256 termDuration
    )
        internal
        returns (MockUSDC usdc, ManualTrigger trig, CatBondHarness bond)
    {
        usdc = new MockUSDC();
        trig = new ManualTrigger(address(this));  // this contract owns the trigger
        bond = new CatBondHarness(
            address(this),   // sponsor
            address(this),   // companyWallet
            address(trig),
            address(usdc),
            uint16(COUPON_BPS),
            coverage,
            minInvest,
            subDuration,
            termDuration
        );
    }

    function _sponsorFund(MockUSDC usdc, CatBondHarness bond) internal {
        uint256 budget = bond.requiredCouponBudget();
        usdc.mint(address(this), _withFee(budget));
        usdc.approve(address(bond), _withFee(budget));
        bond.fundCouponBudget();
    }

    function _investorDeposit(
        MockUSDC usdc,
        InvestorProxy inv,
        uint256 principal
    ) internal {
        usdc.mint(address(inv), _withFee(principal));
        inv.approveAndDeposit(principal, principal);
    }

    function _closeSubscription(CatBondHarness bond) internal {
        bond.advanceTime(bond.subscriptionDuration() + 1);
        bond.closeSubscription();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1 — Happy path
    // Sponsor funds → 3 investors deposit → subscription closes →
    // investors claim coupon progressively → company marks matured →
    // investors withdraw principal.
    // ─────────────────────────────────────────────────────────────────────────
    function test_HappyPath() external {
        (MockUSDC usdc, , CatBondHarness bond) = _deploy(
            COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
        );
        InvestorProxy inv1 = new InvestorProxy(address(usdc), address(bond));
        InvestorProxy inv2 = new InvestorProxy(address(usdc), address(bond));
        InvestorProxy inv3 = new InvestorProxy(address(usdc), address(bond));

        _sponsorFund(usdc, bond);
        require(uint(bond.status()) == uint(CatBond.Status.Subscription),
            "FAIL: should be Subscription after fundCouponBudget");

        _investorDeposit(usdc, inv1, 25_000e6);
        _investorDeposit(usdc, inv2, 25_000e6);
        _investorDeposit(usdc, inv3, 25_000e6);
        require(bond.totalDeposited() == COVERAGE,
            "FAIL: totalDeposited should equal coverage after 3 x $25k deposits");

        _closeSubscription(bond);
        require(uint(bond.status()) == uint(CatBond.Status.Active),
            "FAIL: should be Active after closeSubscription");

        // ── Advance to half-term; inv1 claims first half of coupon ───────────
        bond.advanceTime(TERM_DURATION / 2);
        inv1.claimCoupon();
        require(inv1.balance() > 0, "FAIL: inv1 should receive some coupon at half-term");

        // ── Advance to full maturity; all investors claim remaining coupon ────
        bond.advanceTime(TERM_DURATION / 2);

        uint256 fullCoupon = 25_000e6 * COUPON_BPS / 10_000;  // flat rate on principal

        inv1.claimCoupon();  // collects remaining half
        require(inv1.balance() == fullCoupon,
            "FAIL: inv1 total coupon should equal full flat-rate coupon at maturity");

        inv2.claimCoupon();
        require(inv2.balance() == fullCoupon, "FAIL: inv2 coupon mismatch");

        inv3.claimCoupon();
        require(inv3.balance() == fullCoupon, "FAIL: inv3 coupon mismatch");

        // ── Company marks matured; investors withdraw principal ───────────────
        bond.markMatured();
        require(uint(bond.status()) == uint(CatBond.Status.Matured),
            "FAIL: should be Matured after markMatured");

        inv1.withdrawPrincipal();
        require(inv1.balance() == fullCoupon + 25_000e6,
            "FAIL: inv1 should hold coupon + principal after withdrawal");

        inv2.withdrawPrincipal();
        inv3.withdrawPrincipal();
        require(inv2.balance() == fullCoupon + 25_000e6, "FAIL: inv2 balance mismatch");
        require(inv3.balance() == fullCoupon + 25_000e6, "FAIL: inv3 balance mismatch");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2 — 50% vesting at 1-hour midpoint (2-hour term)
    //
    // Verifies linear vesting:
    //   - At t=1h (50% elapsed): exactly 50% of coupon is claimable.
    //   - A second claim in the same block reverts (NothingToClaim).
    //   - At t=2h (100% elapsed): the remaining 50% becomes claimable.
    //   - Total claimed == full coupon.
    // ─────────────────────────────────────────────────────────────────────────
    function test_HalfVesting2Hr() external {
        uint256 TWO_HOURS = 2 hours;
        uint256 ONE_HOUR  = 1 hours;
        uint256 principal = 25_000e6;

        // subscriptionDuration=1 so we can close immediately after funding.
        (MockUSDC usdc, , CatBondHarness bond) = _deploy(
            principal, principal, 1, TWO_HOURS
        );
        InvestorProxy inv = new InvestorProxy(address(usdc), address(bond));

        _sponsorFund(usdc, bond);
        _investorDeposit(usdc, inv, principal);
        _closeSubscription(bond);  // advances mockTime by 2s, sets activeStart

        // Full coupon over 2-hour term: flat rate on principal (not annualized)
        uint256 totalCoupon = principal * COUPON_BPS / 10_000;

        // ── t = 1 hour (50% of term elapsed) ─────────────────────────────────
        bond.advanceTime(ONE_HOUR);
        inv.claimCoupon();

        uint256 expected50pct = totalCoupon * ONE_HOUR / TWO_HOURS;
        require(inv.balance() == expected50pct,
            "FAIL: at 1h, investor should only be able to claim exactly 50% of coupon");

        // Second claim at the same mock timestamp must revert — nothing new has vested
        bool reverted;
        try inv.claimCoupon() { reverted = false; } catch { reverted = true; }
        require(reverted,
            "FAIL: second claimCoupon in same block should revert with NothingToClaim");

        // ── t = 2 hours (100% of term elapsed) ───────────────────────────────
        bond.advanceTime(ONE_HOUR);
        inv.claimCoupon();

        require(inv.balance() == totalCoupon,
            "FAIL: at 2h, investor should have claimed full coupon across both calls");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3 — Trigger fires at quarter-term
    // Sponsor receives all principal; investors can only claim coupon up to
    // settlementTime (25% of full coupon). Principal is NOT returned.
    // ─────────────────────────────────────────────────────────────────────────
    function test_TriggerPath() external {
        (MockUSDC usdc, ManualTrigger trig, CatBondHarness bond) = _deploy(
            COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
        );
        InvestorProxy inv1 = new InvestorProxy(address(usdc), address(bond));
        InvestorProxy inv2 = new InvestorProxy(address(usdc), address(bond));
        InvestorProxy inv3 = new InvestorProxy(address(usdc), address(bond));

        _sponsorFund(usdc, bond);
        _investorDeposit(usdc, inv1, 25_000e6);
        _investorDeposit(usdc, inv2, 25_000e6);
        _investorDeposit(usdc, inv3, 25_000e6);
        _closeSubscription(bond);

        // Advance to quarter-term, fire trigger, settle
        bond.advanceTime(TERM_DURATION / 4);
        trig.setTriggered(true);

        uint256 sponsorBefore = usdc.balanceOf(address(this));
        bond.settle();

        require(uint(bond.status()) == uint(CatBond.Status.Triggered),
            "FAIL: should be Triggered after settle");
        require(usdc.balanceOf(address(this)) - sponsorBefore == COVERAGE,
            "FAIL: sponsor should receive exact coverage amount on settlement");

        // Investor can only claim coupon vested up to settlementTime (25% of full term)
        inv1.claimCoupon();
        uint256 fullCoupon    = 25_000e6 * COUPON_BPS / 10_000;  // flat rate
        uint256 quarterCoupon = fullCoupon / 4;
        require(inv1.balance() == quarterCoupon,
            "FAIL: investor should only receive coupon vested up to settlement");

        // Coupon is fully consumed — second claim reverts
        bool reverted;
        try inv1.claimCoupon() { reverted = false; } catch { reverted = true; }
        require(reverted, "FAIL: second claimCoupon after full vest should revert");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4 — Fee accounting
    // Exact amounts flow to companyWallet; contract holds exact principal amounts.
    // ─────────────────────────────────────────────────────────────────────────
    function test_FeeAccounting() external {
        (MockUSDC usdc, , CatBondHarness bond) = _deploy(
            COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
        );
        InvestorProxy inv1 = new InvestorProxy(address(usdc), address(bond));

        uint256 budget    = bond.requiredCouponBudget();
        uint256 budgetFee = budget * 50 / 10_000;

        // companyWallet == address(this), so we track its balance as our own.
        // Note: sponsor == address(this) too, so the fee transfer from sponsor to
        // companyWallet is from-self-to-self and nets to zero in MockUSDC.
        // The real check is that the bond holds exactly `budget` and nothing more.
        uint256 bondBefore = usdc.balanceOf(address(bond));
        _sponsorFund(usdc, bond);
        require(usdc.balanceOf(address(bond)) - bondBefore == budget,
            "FAIL: bond should hold exactly requiredCouponBudget after funding");

        // Investor deposits $25k
        uint256 deposit1    = 25_000e6;
        uint256 invFee      = deposit1 * 50 / 10_000;   // $125
        uint256 cwBefore    = usdc.balanceOf(address(this));
        uint256 bondBefore2 = usdc.balanceOf(address(bond));

        _investorDeposit(usdc, inv1, deposit1);

        require(usdc.balanceOf(address(this)) - cwBefore == invFee,
            "FAIL: companyWallet should receive exactly $125 fee on $25k deposit");
        require(usdc.balanceOf(address(bond)) - bondBefore2 == deposit1,
            "FAIL: bond should receive exactly $25k (not $25k+fee)");
        require(bond.principalOf(address(inv1)) == deposit1,
            "FAIL: principalOf investor should be $25k, not $25k+fee");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5 — Key revert cases
    // Each scenario that should be rejected is confirmed to revert.
    // ─────────────────────────────────────────────────────────────────────────
    function test_Reverts() external {
        bool rev;

        // ── Deposit below minimum ─────────────────────────────────────────────
        {
            (MockUSDC usdc, , CatBondHarness bond) = _deploy(
                COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
            );
            InvestorProxy inv = new InvestorProxy(address(usdc), address(bond));
            _sponsorFund(usdc, bond);
            usdc.mint(address(inv), _withFee(1_000e6));
            try inv.approveAndDeposit(1_000e6, 1_000e6) { rev = false; } catch { rev = true; }
            require(rev, "FAIL: deposit below minimum should revert");
        }

        // ── Deposit after subscriptionEnd ─────────────────────────────────────
        {
            (MockUSDC usdc, , CatBondHarness bond) = _deploy(
                COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
            );
            InvestorProxy inv = new InvestorProxy(address(usdc), address(bond));
            _sponsorFund(usdc, bond);
            bond.advanceTime(SUB_DURATION + 1);  // past subscriptionEnd
            usdc.mint(address(inv), _withFee(25_000e6));
            try inv.approveAndDeposit(25_000e6, 25_000e6) { rev = false; } catch { rev = true; }
            require(rev, "FAIL: deposit after subscriptionEnd should revert");
        }

        // ── closeSubscription before subscriptionEnd ──────────────────────────
        {
            (MockUSDC usdc, , CatBondHarness bond) = _deploy(
                COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
            );
            _sponsorFund(usdc, bond);  // subscriptionEnd is now in the future
            try bond.closeSubscription() { rev = false; } catch { rev = true; }
            require(rev, "FAIL: closeSubscription before end should revert");
        }

        // ── settle() when trigger has not fired ───────────────────────────────
        {
            (MockUSDC usdc, , CatBondHarness bond) = _deploy(
                COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
            );
            InvestorProxy inv = new InvestorProxy(address(usdc), address(bond));
            _sponsorFund(usdc, bond);
            _investorDeposit(usdc, inv, 25_000e6);
            _closeSubscription(bond);
            try bond.settle() { rev = false; } catch { rev = true; }
            require(rev, "FAIL: settle without trigger should revert");
        }

        // ── markMatured() before maturity timestamp ───────────────────────────
        {
            (MockUSDC usdc, , CatBondHarness bond) = _deploy(
                COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
            );
            InvestorProxy inv = new InvestorProxy(address(usdc), address(bond));
            _sponsorFund(usdc, bond);
            _investorDeposit(usdc, inv, 25_000e6);
            _closeSubscription(bond);
            // mockTime is at activeStart — maturity is termDuration away
            try bond.markMatured() { rev = false; } catch { rev = true; }
            require(rev, "FAIL: markMatured before maturity should revert");
        }

        // ── markMatured() when trigger has fired ──────────────────────────────
        {
            (MockUSDC usdc, ManualTrigger trig, CatBondHarness bond) = _deploy(
                COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
            );
            InvestorProxy inv = new InvestorProxy(address(usdc), address(bond));
            _sponsorFund(usdc, bond);
            _investorDeposit(usdc, inv, 25_000e6);
            _closeSubscription(bond);
            trig.setTriggered(true);
            bond.advanceTime(TERM_DURATION + 1);
            try bond.markMatured() { rev = false; } catch { rev = true; }
            require(rev, "FAIL: markMatured when trigger fired should revert");
        }

        // ── Double principal withdrawal ────────────────────────────────────────
        {
            (MockUSDC usdc, , CatBondHarness bond) = _deploy(
                COVERAGE, MIN_INVEST, SUB_DURATION, TERM_DURATION
            );
            InvestorProxy inv = new InvestorProxy(address(usdc), address(bond));
            _sponsorFund(usdc, bond);
            _investorDeposit(usdc, inv, 25_000e6);
            _closeSubscription(bond);
            bond.advanceTime(TERM_DURATION);
            bond.markMatured();
            inv.withdrawPrincipal();  // first withdrawal succeeds
            try inv.withdrawPrincipal() { rev = false; } catch { rev = true; }
            require(rev, "FAIL: second withdrawPrincipal should revert");
        }
    }
}
