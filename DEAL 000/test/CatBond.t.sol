// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "catbond/CatBond.sol";
import "catbond/TriggerBase.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal ERC-20 mock — no dependency on OZ in the test itself.
// ─────────────────────────────────────────────────────────────────────────────
contract MockUSDC {
    string  public name     = "USD Coin";
    string  public symbol   = "USDC";
    uint8   public decimals = 6;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from]           >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Concrete triggers for testing
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Fixed config, owner doubles as reporter — for tests that just need a
///      working trigger and don't care about maxReportAge/reporter details.
///      365-day maxReportAge comfortably covers this suite's 365-day terms.
contract TestTrigger is TriggerBase {
    constructor(address _owner)
        TriggerBase(_owner, _owner, "test_product", 1, "value.path", "usd_billions", 365 days, "https://example.com")
    {}
}

/// @dev Lets a test control owner, reporter, and maxReportAge independently —
///      needed for access-control tests and staleness tests.
contract TestTriggerConfigurable is TriggerBase {
    constructor(address _owner, address _reporter, uint256 _maxReportAge)
        TriggerBase(_owner, _reporter, "test_product", 1, "value.path", "usd_billions", _maxReportAge, "https://example.com")
    {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────
contract CatBondTest is Test {

    // ── shared actors ────────────────────────────────────────────────────────
    address sponsor       = address(0xA1);
    address companyWallet = address(0xA2);
    address investor1     = address(0xB1);
    address investor2     = address(0xB2);
    address investor3     = address(0xB3);
    address stranger      = address(0xCC);

    // ── shared bond parameters ───────────────────────────────────────────────
    // NOTE: COUPON_BPS must be uint256 here. Using uint16 causes Solidity 0.8 to
    // narrow large literal intermediates (e.g. 25_000 * 1e6) to uint16 before
    // multiplying, producing a runtime arithmetic panic (0x11). The contract
    // parameter is still uint16 — we cast at the constructor call site.
    uint256 constant COUPON_BPS           = 500;            // 5% p.a.
    uint256 constant COVERAGE             = 75_000 * 1e6;   // $75,000 coverage
    uint256 constant MIN_INVEST           = 25_000 * 1e6;   // $25,000 min
    uint256 constant SUB_DURATION         = 7 days;
    uint256 constant TERM_DURATION        = 365 days;        // 1-year term
    uint256 constant BPS_DENOMINATOR      = 10_000;
    // Threshold = 1 (whole USD): any real postReport() value fires this bond's
    // trigger, mirroring the old TestTrigger's fixed lossLimit=1 convenience.
    uint256 constant THRESHOLD            = 1;

    // ── contracts ────────────────────────────────────────────────────────────
    MockUSDC    usdc;
    TestTrigger trig;
    CatBond     bond;

    // ── helpers ───────────────────────────────────────────────────────────────

    function setUp() public {
        usdc = new MockUSDC();
        trig = new TestTrigger(companyWallet);
        bond = new CatBond(
            sponsor,
            companyWallet,
            address(trig),
            THRESHOLD,
            address(usdc),
            uint16(COUPON_BPS),
            COVERAGE,
            MIN_INVEST,
            SUB_DURATION,
            TERM_DURATION,
            "Test Seller",
            "test-deal-id",
            new CatBond.ExposureRegion[](0)
        );
    }

    /// @dev Returns amount + 0.5% fee
    function withFee(uint256 amount) internal pure returns (uint256) {
        return amount + amount * 50 / 10_000;
    }

    /// @dev Fund sponsor wallet and approve bond for coupon budget + fee.
    function _sponsorFunds() internal {
        uint256 budget = bond.requiredCouponBudget();
        uint256 total  = withFee(budget);
        usdc.mint(sponsor, total);
        vm.prank(sponsor);
        usdc.approve(address(bond), total);
        vm.prank(sponsor);
        bond.fundCouponBudget();
    }

    /// @dev Mint and approve USDC for an investor, then deposit.
    function _investorDeposits(address inv, uint256 principal) internal {
        uint256 total = withFee(principal);
        usdc.mint(inv, total);
        vm.prank(inv);
        usdc.approve(address(bond), total);
        vm.prank(inv);
        bond.deposit(principal, principal);
    }

    /// @dev Close subscription (warp past subscriptionEnd first).
    function _closeSubscription() internal {
        vm.warp(bond.subscriptionEnd() + 1);
        bond.closeSubscription();
    }

    /// @dev Post a report from the company wallet (the trigger's reporter).
    function _report(uint256 value) internal {
        vm.prank(companyWallet);
        trig.postReport(value, bytes32(0));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. HAPPY PATH — full lifecycle without trigger
    // Protects: sponsor funds → investors deposit → maturity → principal returned
    // ─────────────────────────────────────────────────────────────────────────
    function test_HappyPath() public {
        uint256 budget = bond.requiredCouponBudget();
        console2.log("budget", budget);

        // ── sponsor funds ────────────────────────────────────────────────────
        _sponsorFunds();
        assertEq(uint(bond.status()), uint(CatBond.Status.Subscription));

        // Contract holds the full coupon budget
        assertEq(usdc.balanceOf(address(bond)), budget);

        // ── 3 investors deposit $25k each ────────────────────────────────────
        _investorDeposits(investor1, 25_000 * 1e6);
        _investorDeposits(investor2, 25_000 * 1e6);
        _investorDeposits(investor3, 25_000 * 1e6);

        assertEq(bond.totalDeposited(), COVERAGE);  // $75k fills coverage
        assertEq(bond.principalOf(investor1), 25_000 * 1e6);

        // ── close subscription ───────────────────────────────────────────────
        _closeSubscription();
        assertEq(uint(bond.status()), uint(CatBond.Status.Active));

        // ── warp halfway; investors claim coupon ─────────────────────────────
        uint256 halfTerm = TERM_DURATION / 2;
        vm.warp(bond.activeStart() + halfTerm);

        uint256 inv1Before = usdc.balanceOf(investor1);
        vm.prank(investor1);
        bond.claimCoupon();
        uint256 inv1CouponHalf = usdc.balanceOf(investor1) - inv1Before;
        assertGt(inv1CouponHalf, 0);

        // ── warp to full term; claim remaining coupon ────────────────────────
        vm.warp(bond.maturity());

        vm.prank(investor1);
        bond.claimCoupon();
        uint256 inv1TotalCoupon = usdc.balanceOf(investor1);  // only coupon so far
        // total coupon for investor1 = 25000 * 5% * 1y
        uint256 expectedTotal = 25_000 * 1e6 * COUPON_BPS * TERM_DURATION
                                / (10_000 * 365 days);
        assertEq(inv1TotalCoupon, expectedTotal);

        // ── company must have a fresh, below-threshold report before markMatured() ──
        // Under the new "checkTrigger() first, always" design, markMatured() —
        // like settle() — requires a valid report in window. A missed report
        // blocks either outcome; this is the operational tradeoff the sprint
        // takes on instead of paying an oracle network (see api/it3_plan_
        // triggers_n_mgmnt.md §1). Posting at exactly `maturity` keeps it
        // fresh relative to TestTrigger's 365-day maxReportAge.
        _report(0);

        // ── company calls markMatured ─────────────────────────────────────────
        vm.prank(companyWallet);
        bond.markMatured();
        assertEq(uint(bond.status()), uint(CatBond.Status.Matured));

        // ── investors withdraw principal ──────────────────────────────────────
        vm.prank(investor1);
        bond.withdrawPrincipal();
        assertEq(usdc.balanceOf(investor1), expectedTotal + 25_000 * 1e6);

        vm.prank(investor2);
        bond.withdrawPrincipal();
        vm.prank(investor3);
        bond.withdrawPrincipal();

        // All investor principals returned
        assertEq(usdc.balanceOf(investor2), 25_000 * 1e6);
        assertEq(usdc.balanceOf(investor3), 25_000 * 1e6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. TRIGGER PATH — trigger fires mid-term
    // Protects: sponsor gets principal; investors only claim coupon up to settlementTime
    // ─────────────────────────────────────────────────────────────────────────
    function test_TriggerPath() public {
        _sponsorFunds();
        _investorDeposits(investor1, 25_000 * 1e6);
        _investorDeposits(investor2, 25_000 * 1e6);
        _investorDeposits(investor3, 25_000 * 1e6);
        _closeSubscription();

        // Warp to 1/4 of term
        uint256 quarterTerm = TERM_DURATION / 4;
        vm.warp(bond.activeStart() + quarterTerm);

        // Trigger fires — a fresh report at/above this bond's threshold (1)
        _report(1);

        uint256 sponsorBefore = usdc.balanceOf(sponsor);

        // Company wallet settles
        vm.prank(companyWallet);
        bond.settle();

        assertEq(uint(bond.status()), uint(CatBond.Status.Triggered));
        // Sponsor received all $75k principal
        assertEq(usdc.balanceOf(sponsor) - sponsorBefore, COVERAGE);

        // Investor claims coupon — should be ~25% of full coupon
        uint256 inv1Before = usdc.balanceOf(investor1);
        vm.prank(investor1);
        bond.claimCoupon();
        uint256 couponReceived = usdc.balanceOf(investor1) - inv1Before;

        uint256 fullCoupon = 25_000 * 1e6 * COUPON_BPS * TERM_DURATION
                             / (10_000 * 365 days);
        uint256 expectedCoupon = fullCoupon * quarterTerm / TERM_DURATION;
        assertEq(couponReceived, expectedCoupon);

        // Investor cannot claim more after all vested coupon claimed
        vm.prank(investor1);
        vm.expectRevert(CatBond.NothingToClaim.selector);
        bond.claimCoupon();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. FEE ACCOUNTING
    // Protects: fee math is exact; contract holds exactly the right principal amount
    // ─────────────────────────────────────────────────────────────────────────
    function test_FeeAccounting() public {
        uint256 budget   = bond.requiredCouponBudget();
        uint256 budgetFee = budget * 50 / 10_000;

        // ── Sponsor funds ────────────────────────────────────────────────────
        uint256 cwBefore = usdc.balanceOf(companyWallet);
        _sponsorFunds();
        assertEq(usdc.balanceOf(companyWallet) - cwBefore, budgetFee,
            "company wallet: sponsor fee");
        assertEq(usdc.balanceOf(address(bond)), budget,
            "contract: holds exact coupon budget");

        // ── Investor 1 deposits $25k ──────────────────────────────────────────
        uint256 deposit1 = 25_000 * 1e6;
        uint256 fee1     = deposit1 * 50 / 10_000;  // $125
        cwBefore = usdc.balanceOf(companyWallet);
        uint256 contractBefore = usdc.balanceOf(address(bond));
        _investorDeposits(investor1, deposit1);

        assertEq(usdc.balanceOf(companyWallet) - cwBefore, fee1,
            "company wallet: investor1 fee ($125)");
        assertEq(usdc.balanceOf(address(bond)) - contractBefore, deposit1,
            "contract: holds exact investor1 principal");
        assertEq(bond.principalOf(investor1), deposit1,
            "principalOf investor1 = $25k");

        // ── Cumulative fee after 3 deposits ──────────────────────────────────
        _investorDeposits(investor2, 25_000 * 1e6);
        _investorDeposits(investor3, 25_000 * 1e6);

        uint256 totalFees = budgetFee + fee1 * 3;  // fee1 same for all three investors
        assertEq(usdc.balanceOf(companyWallet), totalFees,
            "company wallet: cumulative fees correct");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. REJECTION PATHS
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Deposit below minimum reverts.
    function test_Reject_BelowMinInvestment() public {
        _sponsorFunds();
        uint256 tinyAmount = 1_000 * 1e6;  // $1,000 < $25,000 min
        usdc.mint(investor1, withFee(tinyAmount));
        vm.prank(investor1);
        usdc.approve(address(bond), withFee(tinyAmount));
        vm.prank(investor1);
        vm.expectRevert(CatBond.BelowMinInvestment.selector);
        bond.deposit(tinyAmount, tinyAmount);
    }

    /// @dev Deposit where accepted > maxAccepted reverts (consent check).
    function test_Reject_ExceedsMaxAccepted() public {
        _sponsorFunds();
        // Fill $50k of $75k capacity
        _investorDeposits(investor1, 25_000 * 1e6);
        _investorDeposits(investor2, 25_000 * 1e6);

        // investor3 wants $30k but only $25k remains; they pass maxAccepted=25k-1 → reverts
        uint256 desired = 30_000 * 1e6;
        uint256 max     = 25_000 * 1e6 - 1;
        usdc.mint(investor3, withFee(desired));
        vm.prank(investor3);
        usdc.approve(address(bond), withFee(desired));
        vm.prank(investor3);
        vm.expectRevert(CatBond.ExceedsMaxAccepted.selector);
        bond.deposit(desired, max);
    }

    /// @dev Deposit after subscriptionEnd reverts.
    function test_Reject_DepositAfterExpiry() public {
        _sponsorFunds();
        vm.warp(bond.subscriptionEnd() + 1);
        usdc.mint(investor1, withFee(25_000 * 1e6));
        vm.prank(investor1);
        usdc.approve(address(bond), withFee(25_000 * 1e6));
        vm.prank(investor1);
        vm.expectRevert(CatBond.SubscriptionExpired.selector);
        bond.deposit(25_000 * 1e6, 25_000 * 1e6);
    }

    /// @dev Deposit without approving the fee on top reverts.
    function test_Reject_InsufficientApproval() public {
        _sponsorFunds();
        uint256 principal = 25_000 * 1e6;
        usdc.mint(investor1, withFee(principal));
        vm.prank(investor1);
        usdc.approve(address(bond), principal);  // only approves principal, not fee
        vm.prank(investor1);
        vm.expectRevert();  // SafeERC20 will revert on insufficient allowance
        bond.deposit(principal, principal);
    }

    /// @dev closeSubscription before subscriptionEnd reverts.
    function test_Reject_CloseSubscriptionEarly() public {
        _sponsorFunds();
        vm.expectRevert(CatBond.SubscriptionStillOpen.selector);
        bond.closeSubscription();
    }

    /// @dev settle() from non-company wallet reverts — access control fires
    ///      before checkTrigger() is ever reached, so no report is needed.
    function test_Reject_SettleFromStranger() public {
        _sponsorFunds();
        _investorDeposits(investor1, 25_000 * 1e6);
        _closeSubscription();
        vm.prank(stranger);
        vm.expectRevert(CatBond.NotCompanyWallet.selector);
        bond.settle();
    }

    /// @dev settle() reverts when no report has ever been posted — checkTrigger()'s
    ///      revert (from the trigger's own empty report log) propagates, it is
    ///      not swallowed into "not triggered."
    function test_Reject_SettleWhenNoReportPosted() public {
        _sponsorFunds();
        _investorDeposits(investor1, 25_000 * 1e6);
        _closeSubscription();
        vm.prank(companyWallet);
        vm.expectRevert(TriggerBase.NoReports.selector);
        bond.settle();
    }

    /// @dev settle() reverts with TriggerNotFired specifically when a valid,
    ///      fresh report exists but is below threshold — distinct from the
    ///      no-report-at-all case above.
    function test_Reject_SettleWhenReportedBelowThreshold() public {
        _sponsorFunds();
        _investorDeposits(investor1, 25_000 * 1e6);
        _closeSubscription();
        _report(0); // below THRESHOLD=1
        vm.prank(companyWallet);
        vm.expectRevert(CatBond.TriggerNotFired.selector);
        bond.settle();
    }

    /// @dev markMatured() from non-company wallet reverts.
    function test_Reject_MarkMatureFromStranger() public {
        _sponsorFunds();
        _closeSubscription();
        vm.warp(bond.maturity() + 1);
        vm.prank(stranger);
        vm.expectRevert(CatBond.NotCompanyWallet.selector);
        bond.markMatured();
    }

    /// @dev markMatured() when a fresh report shows the threshold cleared reverts.
    function test_Reject_MarkMatureWhenTriggered() public {
        _sponsorFunds();
        _closeSubscription();
        vm.warp(bond.maturity() + 1);
        _report(1); // posted right before the check, so it's still fresh
        vm.prank(companyWallet);
        vm.expectRevert(CatBond.TriggerAlreadyFired.selector);
        bond.markMatured();
    }

    /// @dev markMatured() before maturity timestamp reverts.
    function test_Reject_MarkMatureBeforeMaturity() public {
        _sponsorFunds();
        _closeSubscription();
        vm.prank(companyWallet);
        vm.expectRevert(CatBond.NotYetMatured.selector);
        bond.markMatured();
    }

    /// @dev claimCoupon() twice in same block returns zero on second call.
    function test_Reject_DoubleClaim() public {
        _sponsorFunds();
        _investorDeposits(investor1, 25_000 * 1e6);
        _closeSubscription();
        vm.warp(bond.activeStart() + TERM_DURATION / 2);

        vm.prank(investor1);
        bond.claimCoupon();

        vm.prank(investor1);
        vm.expectRevert(CatBond.NothingToClaim.selector);
        bond.claimCoupon();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. PARTIAL FILL
    // Protects: capacity cap, maxAccepted consent gate, fee scales with accepted not amount
    // ─────────────────────────────────────────────────────────────────────────
    function test_PartialFill() public {
        // Use a $30M coverage bond for this test
        uint256 bigCoverage = 30_000_000 * 1e6;
        MockUSDC bigUsdc = new MockUSDC();
        TestTrigger bigTrig = new TestTrigger(companyWallet);
        CatBond bigBond = new CatBond(
            sponsor, companyWallet, address(bigTrig), THRESHOLD, address(bigUsdc),
            uint16(COUPON_BPS), bigCoverage, MIN_INVEST, SUB_DURATION, TERM_DURATION,
            "Test Seller", "test-deal-id", new CatBond.ExposureRegion[](0)
        );

        // Sponsor funds
        uint256 bigBudget = bigBond.requiredCouponBudget();
        bigUsdc.mint(sponsor, withFee(bigBudget));
        vm.prank(sponsor);
        bigUsdc.approve(address(bigBond), withFee(bigBudget));
        vm.prank(sponsor);
        bigBond.fundCouponBudget();

        // Two investors deposit $10M each — $20M filled, $10M remaining
        uint256 ten = 10_000_000 * 1e6;
        bigUsdc.mint(investor1, withFee(ten));
        vm.prank(investor1); bigUsdc.approve(address(bigBond), withFee(ten));
        vm.prank(investor1); bigBond.deposit(ten, ten);

        bigUsdc.mint(investor2, withFee(ten));
        vm.prank(investor2); bigUsdc.approve(address(bigBond), withFee(ten));
        vm.prank(investor2); bigBond.deposit(ten, ten);

        // investor3 wants $25M but only $10M remains.
        // ExceedsMaxAccepted fires when accepted > maxAccepted.
        // accepted = min(desired, remaining) = $10M.
        // To trigger the error, set maxAccepted < $10M (e.g. $9M).
        uint256 desired25 = 25_000_000 * 1e6;
        uint256 maxNine   =  9_000_000 * 1e6;
        bigUsdc.mint(investor3, withFee(desired25));
        vm.prank(investor3); bigUsdc.approve(address(bigBond), withFee(desired25));
        vm.prank(investor3);
        vm.expectRevert(CatBond.ExceedsMaxAccepted.selector);
        bigBond.deposit(desired25, maxNine);  // accepted=$10M > maxAccepted=$9M → revert

        // investor3 retries with maxAccepted=$20M — accepts $10M (remaining capacity)
        uint256 max20 = 20_000_000 * 1e6;
        vm.prank(investor3);
        bigBond.deposit(desired25, max20);

        // investor3's principal = $10M (not $25M); fee = $10M * 0.5% = $50k
        uint256 accepted = 10_000_000 * 1e6;
        assertEq(bigBond.principalOf(investor3), accepted);
        uint256 fee = accepted * 50 / 10_000;  // $50,000
        assertEq(fee, 50_000 * 1e6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. UNDERSUBSCRIPTION REFUND
    // Protects: sponsor is refunded unused coupon budget proportional to shortfall
    // ─────────────────────────────────────────────────────────────────────────
    function test_UndersubscriptionRefund() public {
        // $75k coverage but only $50k deposited ($25k shortfall)
        _sponsorFunds();
        _investorDeposits(investor1, 25_000 * 1e6);
        _investorDeposits(investor2, 25_000 * 1e6);
        // investor3 does NOT deposit — $25k of $75k coverage unused

        uint256 sponsorBefore = usdc.balanceOf(sponsor);
        _closeSubscription();

        uint256 unusedCoverage = 25_000 * 1e6;
        uint256 expectedRefund = unusedCoverage * COUPON_BPS * TERM_DURATION
                                 / (10_000 * 365 days);
        uint256 sponsorRefund = usdc.balanceOf(sponsor) - sponsorBefore;
        assertEq(sponsorRefund, expectedRefund,
            "sponsor receives coupon refund for unused coverage");

        // Fee is NOT refunded — it was earned at funding time and stays with company wallet
        // (no assertion needed: fee went to companyWallet at _sponsorFunds(), not to contract)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. LINEAR VESTING — 1-YEAR TERM (realistic coupon amounts)
    // $25k principal at 5% p.a. for 365 days:
    //   totalCoupon = 1,250,000,000 ($1,250 in 6-decimal USDC)
    //   at half-term (182.5 days): $625 claimable
    //   a second same-block claim reverts with NothingToClaim
    //   at full term: remaining $625 claimable
    // ─────────────────────────────────────────────────────────────────────────
    function test_HalfVestingAtHalfTerm() public {
        uint256 principal   = 20_000 * 1e6;   // $25,000
        uint256 halfTerm    = TERM_DURATION / 2;

        // Dedicated bond: 1-year term, 1-second subscription so we can close instantly.
        MockUSDC    yearUsdc = new MockUSDC();
        TestTrigger yearTrig = new TestTrigger(companyWallet);
        CatBond yearBond = new CatBond(
            sponsor,
            companyWallet,
            address(yearTrig),
            THRESHOLD,
            address(yearUsdc),
            uint16(COUPON_BPS),
            principal,   // $25k coverage — one investor fills it exactly
            principal,   // $25k minimum
            1,           // 1-second subscription window
            TERM_DURATION,
            "Test Seller",
            "test-deal-id",
            new CatBond.ExposureRegion[](0)
        );

        // Sponsor funds
        uint256 budget = yearBond.requiredCouponBudget();
        yearUsdc.mint(sponsor, withFee(budget));
        vm.prank(sponsor); yearUsdc.approve(address(yearBond), withFee(budget));
        vm.prank(sponsor); yearBond.fundCouponBudget();

        // Investor deposits $25k (fills coverage exactly)
        yearUsdc.mint(investor1, withFee(principal));
        vm.prank(investor1); yearUsdc.approve(address(yearBond), withFee(principal));
        vm.prank(investor1); yearBond.deposit(principal, principal);

        // Close subscription (warp past the 1-second window)
        vm.warp(yearBond.subscriptionEnd() + 1);
        yearBond.closeSubscription();

        uint256 start = yearBond.activeStart();

        // Full coupon: $25,000 × 5% × 1 year = $1,250 (1,250,000,000 in 6-decimal USDC)
        uint256 totalCoupon = principal * COUPON_BPS * TERM_DURATION / (10_000 * 365 days);
        console2.log("totalCoupon (expect 1000000000 = $1000):", totalCoupon);

        // ── t = 182.5 days: exactly 50% of term elapsed ───────────────────
        vm.warp(start + halfTerm);

        uint256 balBefore = yearUsdc.balanceOf(investor1);
        vm.prank(investor1);
        yearBond.claimCoupon();
        uint256 claimed1 = yearUsdc.balanceOf(investor1) - balBefore;

        uint256 expected50pct = totalCoupon / 2;   // $625
        assertEq(claimed1, expected50pct, "at half-term: exactly $625 claimable");
        console2.log("claimed1 at half-term (expect 625000000 = $625):", claimed1);

        // Second call in the same block — nothing new has vested, must revert
        vm.prank(investor1);
        vm.expectRevert(CatBond.NothingToClaim.selector);
        yearBond.claimCoupon();

        // ── t = 365 days: 100% of term elapsed, claim remaining $625 ──────
        vm.warp(start + TERM_DURATION);

        uint256 balBefore2 = yearUsdc.balanceOf(investor1);
        vm.prank(investor1);
        yearBond.claimCoupon();
        uint256 claimed2 = yearUsdc.balanceOf(investor1) - balBefore2;

        assertEq(claimed2, totalCoupon - claimed1, "at full term: remaining $625 claimable");
        assertEq(claimed1 + claimed2, totalCoupon,  "total claimed equals $1250");
        console2.log("claimed2 at full term (expect 625000000 = $625):", claimed2);
        console2.log("total claimed (expect 1250000000 = $1250):", claimed1 + claimed2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. FUZZ — coupon never exceeds principal × rate × term
    // Forge feeds random (principal, elapsed) pairs and checks the invariant.
    // ─────────────────────────────────────────────────────────────────────────
    function testFuzz_CouponNeverExceedsCap(uint256 principal, uint256 elapsed) public {
        // Bound inputs to realistic ranges
        principal = bound(principal, MIN_INVEST, COVERAGE);
        elapsed   = bound(elapsed, 1, TERM_DURATION);

        _sponsorFunds();

        // Only deposit what fits (principal is already bounded to COVERAGE)
        usdc.mint(investor1, withFee(principal));
        vm.prank(investor1);
        usdc.approve(address(bond), withFee(principal));
        vm.prank(investor1);
        bond.deposit(principal, principal);

        _closeSubscription();

        vm.warp(bond.activeStart() + elapsed);

        uint256 before = usdc.balanceOf(investor1);
        vm.prank(investor1);
        bond.claimCoupon();
        uint256 received = usdc.balanceOf(investor1) - before;

        uint256 cap = principal * COUPON_BPS * TERM_DURATION / (BPS_DENOMINATOR * 365 days);
        assertLe(received, cap, "coupon claimed must never exceed cap");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. FUZZ — fee always equals exactly 0.5% of principal (rounds down)
    // ─────────────────────────────────────────────────────────────────────────
    function testFuzz_FeeIsExactHalfPercent(uint256 principal) public {
        principal = bound(principal, MIN_INVEST, COVERAGE);

        _sponsorFunds();

        usdc.mint(investor1, withFee(principal));
        vm.prank(investor1);
        usdc.approve(address(bond), withFee(principal));

        uint256 cwBefore = usdc.balanceOf(companyWallet);
        vm.prank(investor1);
        bond.deposit(principal, principal);

        uint256 expectedFee = principal * 50 / BPS_DENOMINATOR;
        assertEq(usdc.balanceOf(companyWallet) - cwBefore, expectedFee, "fee must be exactly 0.5%");
        assertEq(bond.principalOf(investor1), principal, "principalOf must equal the un-fee'd amount");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. FUZZ — two sequential coupon claims always sum to ≤ total coupon
    //      Tests that alreadyClaimed prevents over-payment across arbitrary timestamps.
    // ─────────────────────────────────────────────────────────────────────────
    function testFuzz_TwoClaimsSumToAtMostFullCoupon(uint256 t1, uint256 t2) public {
        uint256 principal = 25_000 * 1e6;
        t1 = bound(t1, 1, TERM_DURATION - 1);
        t2 = bound(t2, t1 + 1, TERM_DURATION);

        _sponsorFunds();
        _investorDeposits(investor1, principal);
        _closeSubscription();

        uint256 start = bond.activeStart();

        vm.warp(start + t1);
        uint256 before1 = usdc.balanceOf(investor1);
        vm.prank(investor1);
        bond.claimCoupon();
        uint256 claim1 = usdc.balanceOf(investor1) - before1;

        vm.warp(start + t2);
        uint256 before2 = usdc.balanceOf(investor1);
        vm.prank(investor1);
        bond.claimCoupon();
        uint256 claim2 = usdc.balanceOf(investor1) - before2;

        uint256 cap = principal * COUPON_BPS * TERM_DURATION / (BPS_DENOMINATOR * 365 days);
        assertLe(claim1 + claim2, cap, "two claims must not exceed full coupon");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy-time trigger validation (§2.5 — "reverts if zero or if the address
// does not implement the trigger interface")
// ─────────────────────────────────────────────────────────────────────────────
contract TriggerValidationTest is Test {
    address sponsor       = address(0xA1);
    address companyWallet = address(0xA2);

    // Note: this takes a pre-deployed usdc address rather than creating one
    // itself. vm.expectRevert() attaches to the very next CALL/CREATE the
    // test makes — if this helper created MockUSDC internally, that CREATE
    // (which succeeds) would consume the expectation before `new CatBond`
    // ever ran, and the test would report "next call did not revert."
    function _deployWithTrigger(address triggerAddr, address usdc) internal {
        new CatBond(
            sponsor, companyWallet, triggerAddr, 1, usdc,
            uint16(500), 50_000e6, 25_000e6, 7 days, 30 days,
            "Test Seller", "test-deal-id", new CatBond.ExposureRegion[](0)
        );
    }

    function test_Deploy_RevertsOnZeroTrigger() public {
        address usdc = address(new MockUSDC());
        vm.expectRevert(CatBond.ZeroTrigger.selector);
        _deployWithTrigger(address(0), usdc);
    }

    function test_Deploy_RevertsOnEOATrigger() public {
        address usdc = address(new MockUSDC());
        vm.expectRevert(CatBond.InvalidTrigger.selector);
        _deployWithTrigger(address(0xDEAD), usdc); // no code at this address
    }

    function test_Deploy_RevertsOnNonConformingContract() public {
        address usdc = address(new MockUSDC());
        MockUSDC notATrigger = new MockUSDC(); // has code, but no reportCount()
        vm.expectRevert(CatBond.InvalidTrigger.selector);
        _deployWithTrigger(address(notATrigger), usdc);
    }

    function test_Deploy_SucceedsWithConformingTrigger() public {
        address usdc = address(new MockUSDC());
        TestTrigger trig = new TestTrigger(companyWallet);
        _deployWithTrigger(address(trig), usdc); // must not revert
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard: trigger must not have already fired before subscription closes
// ─────────────────────────────────────────────────────────────────────────────
contract EarlyTriggerGuardTest is Test {

    address sponsor       = address(0xA1);
    address companyWallet = address(0xA2);
    address investor1     = address(0xB1);
    uint256 constant THRESHOLD = 1;

    function _deployAndFundToSubscriptionClose(MockUSDC usdc, TestTrigger trig) internal returns (CatBond) {
        CatBond bond = new CatBond(
            sponsor, companyWallet, address(trig), THRESHOLD, address(usdc),
            uint16(500), 50_000e6, 25_000e6, 7 days, 30 days,
            "Test Seller", "test-deal-id", new CatBond.ExposureRegion[](0)
        );

        uint256 budget = bond.requiredCouponBudget();
        usdc.mint(sponsor, budget + budget * 50 / 10_000);
        vm.prank(sponsor); usdc.approve(address(bond), budget + budget * 50 / 10_000);
        vm.prank(sponsor); bond.fundCouponBudget();

        usdc.mint(investor1, 50_000e6 + 50_000e6 * 50 / 10_000);
        vm.prank(investor1); usdc.approve(address(bond), 50_000e6 + 50_000e6 * 50 / 10_000);
        vm.prank(investor1); bond.deposit(50_000e6, 50_000e6);

        return bond;
    }

    function test_CloseSubscription_RevertsIfTriggerAlreadyFired() public {
        MockUSDC usdc = new MockUSDC();
        TestTrigger trig = new TestTrigger(companyWallet);
        CatBond bond = _deployAndFundToSubscriptionClose(usdc, trig);

        // Report DURING subscription (before closeSubscription) at/above threshold
        vm.prank(companyWallet); trig.postReport(1, bytes32(0));
        assertEq(trig.latestReport().value, 1, "report should be recorded");
        assertEq(uint(bond.status()), uint(CatBond.Status.Subscription), "bond still in Subscription");

        // closeSubscription must revert because the latest report already clears threshold
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(CatBond.TriggerAlreadyFired.selector);
        bond.closeSubscription();
    }

    /// @dev The report log is append-only and has no permanent "latched" memory —
    ///      only the single latest report matters. A later below-threshold report
    ///      supersedes an earlier above-threshold one for the early guard's purposes.
    function test_CloseSubscription_SucceedsWhenLatestReportIsBelowThreshold() public {
        MockUSDC usdc = new MockUSDC();
        TestTrigger trig = new TestTrigger(companyWallet);
        CatBond bond = _deployAndFundToSubscriptionClose(usdc, trig);

        vm.prank(companyWallet); trig.postReport(5, bytes32(0));  // above threshold
        vm.prank(companyWallet); trig.postReport(0, bytes32(0));  // latest: below threshold

        vm.warp(block.timestamp + 7 days + 1);
        bond.closeSubscription();
        assertEq(uint(bond.status()), uint(CatBond.Status.Active), "bond must be Active - latest report is what counts");
    }

    function test_CloseSubscription_SucceedsWhenNoReportsExist() public {
        MockUSDC usdc = new MockUSDC();
        TestTrigger trig = new TestTrigger(companyWallet);
        CatBond bond = _deployAndFundToSubscriptionClose(usdc, trig);

        assertEq(trig.reportCount(), 0);
        vm.warp(block.timestamp + 7 days + 1);
        bond.closeSubscription(); // must not revert — nothing to guard against
        assertEq(uint(bond.status()), uint(CatBond.Status.Active));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TriggerBase — reporter role, report log, and CatBond.checkTrigger() against it
// ─────────────────────────────────────────────────────────────────────────────
contract TriggerReportTest is Test {

    address owner        = address(0xA1);
    address reporterAddr = address(0xA3);
    address other        = address(0xB1);

    // ── TriggerBase unit tests ───────────────────────────────────────────────

    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(TriggerBase.ZeroAddress.selector);
        new TestTriggerConfigurable(address(0), reporterAddr, 365 days);
    }

    function test_Constructor_RevertsOnZeroReporter() public {
        vm.expectRevert(TriggerBase.ZeroAddress.selector);
        new TestTriggerConfigurable(owner, address(0), 365 days);
    }

    function test_ReportCount_And_LatestReport_EmptyReverts() public {
        TestTriggerConfigurable trig = new TestTriggerConfigurable(owner, reporterAddr, 365 days);
        assertEq(trig.reportCount(), 0);
        vm.expectRevert(TriggerBase.NoReports.selector);
        trig.latestReport();
    }

    function test_PostReport_AppendsAndReads() public {
        TestTriggerConfigurable trig = new TestTriggerConfigurable(owner, reporterAddr, 365 days);
        vm.prank(reporterAddr);
        trig.postReport(370_000_000_000, bytes32("ref1"));

        assertEq(trig.reportCount(), 1);
        ITrigger.Report memory r = trig.latestReport();
        assertEq(r.value, 370_000_000_000);
        assertEq(r.reportedAt, block.timestamp);
        assertEq(r.reporter, reporterAddr);
        assertEq(r.monitorRef, bytes32("ref1"));
    }

    function test_PostReport_OnlyReporter() public {
        TestTriggerConfigurable trig = new TestTriggerConfigurable(owner, reporterAddr, 365 days);
        vm.prank(other);
        vm.expectRevert(TriggerBase.NotReporter.selector);
        trig.postReport(1, bytes32(0));
    }

    function test_PostReport_MultipleAppendsInOrder() public {
        TestTriggerConfigurable trig = new TestTriggerConfigurable(owner, reporterAddr, 365 days);
        vm.prank(reporterAddr); trig.postReport(100, bytes32("a"));
        vm.warp(block.timestamp + 1 days);
        vm.prank(reporterAddr); trig.postReport(200, bytes32("b"));

        assertEq(trig.reportCount(), 2);
        assertEq(trig.latestReport().value, 200, "latest must be the most recent, not the first");
    }

    function test_LatestReportSince_RespectsWindow() public {
        TestTriggerConfigurable trig = new TestTriggerConfigurable(owner, reporterAddr, 365 days);
        uint256 t0 = block.timestamp;
        vm.prank(reporterAddr); trig.postReport(100, bytes32(0));

        ITrigger.Report memory r = trig.latestReportSince(t0);
        assertEq(r.value, 100);

        vm.expectRevert(TriggerBase.NoReports.selector);
        trig.latestReportSince(t0 + 1); // the only report predates this window
    }

    function test_SetReporter_OwnerOnlyAndTakesEffect() public {
        TestTriggerConfigurable trig = new TestTriggerConfigurable(owner, reporterAddr, 365 days);

        vm.prank(other);
        vm.expectRevert(TriggerBase.NotOwner.selector);
        trig.setReporter(other);

        vm.prank(owner);
        trig.setReporter(other);
        assertEq(trig.reporter(), other);

        vm.prank(reporterAddr);
        vm.expectRevert(TriggerBase.NotReporter.selector);
        trig.postReport(1, bytes32(0));

        vm.prank(other);
        trig.postReport(1, bytes32(0));
        assertEq(trig.reportCount(), 1);
    }

    function test_MaxReportAge_ReflectsProductConfigSnapshot() public {
        TestTriggerConfigurable trig = new TestTriggerConfigurable(owner, reporterAddr, 42 days);
        assertEq(trig.maxReportAge(), 42 days);
    }

    // ── CatBond.checkTrigger() / settle() against a real report log ─────────

    uint256 constant BOND_THRESHOLD = 370_000_000_000; // $370B

    /// @dev address(this) plays sponsor/companyWallet/reporter throughout, same
    ///      simplification the original single-file test used — no vm.prank
    ///      juggling needed for the deploy+fund+deposit+close sequence.
    function _activeBond(uint256 maxReportAge) internal returns (CatBond bond, TestTriggerConfigurable trig, MockUSDC usdc) {
        usdc = new MockUSDC();
        trig = new TestTriggerConfigurable(address(this), address(this), maxReportAge);

        bond = new CatBond(
            address(this), address(this), address(trig), BOND_THRESHOLD, address(usdc),
            uint16(500), 75_000e6, 25_000e6, 1, 30 days,
            "Test Seller", "test-deal-id", new CatBond.ExposureRegion[](0)
        );

        uint256 budget = bond.requiredCouponBudget();
        usdc.mint(address(this), budget + budget * 50 / 10_000);
        usdc.approve(address(bond), budget + budget * 50 / 10_000);
        bond.fundCouponBudget();

        address inv = address(0xCC);
        uint256 principal = 25_000e6;
        usdc.mint(inv, principal + principal * 50 / 10_000);
        vm.prank(inv);
        usdc.approve(address(bond), principal + principal * 50 / 10_000);
        vm.prank(inv);
        bond.deposit(principal, principal);

        vm.warp(block.timestamp + 2);
        bond.closeSubscription();
    }

    function test_CheckTrigger_FiresAtExactlyThreshold() public {
        (CatBond bond, TestTriggerConfigurable trig,) = _activeBond(365 days);

        vm.warp(bond.activeStart() + 10 days);
        trig.postReport(BOND_THRESHOLD, bytes32("ref"));

        assertTrue(bond.checkTrigger(), "must fire at exactly the threshold");
        (uint256 v, uint256 reportedAt, bool triggered, uint256 checkedAt, address checkedBy) = bond.lastCheck();
        assertEq(v, BOND_THRESHOLD);
        assertEq(reportedAt, block.timestamp);
        assertTrue(triggered);
        assertEq(checkedAt, block.timestamp);
        assertEq(checkedBy, address(this));
    }

    function test_CheckTrigger_FiresAboveThreshold() public {
        (CatBond bond, TestTriggerConfigurable trig,) = _activeBond(365 days);
        vm.warp(bond.activeStart() + 10 days);
        trig.postReport(BOND_THRESHOLD + 1, bytes32(0));
        assertTrue(bond.checkTrigger());
    }

    function test_CheckTrigger_DoesNotFireBelowThreshold() public {
        (CatBond bond, TestTriggerConfigurable trig,) = _activeBond(365 days);
        vm.warp(bond.activeStart() + 10 days);
        trig.postReport(BOND_THRESHOLD - 1, bytes32(0));
        assertFalse(bond.checkTrigger());
    }

    function test_CheckTrigger_RevertsWhenStale() public {
        (CatBond bond, TestTriggerConfigurable trig,) = _activeBond(30 days);
        vm.warp(bond.activeStart() + 1 days);
        trig.postReport(BOND_THRESHOLD + 1, bytes32(0));

        vm.warp(bond.activeStart() + 1 days + 30 days + 1); // just past max_report_age
        vm.expectRevert(CatBond.StaleReport.selector);
        bond.checkTrigger();
    }

    function test_CheckTrigger_RevertsWhenReportPredatesCommencement() public {
        // Report BEFORE closeSubscription runs — never valid for this bond,
        // no matter how fresh, since latestReportSince(activeStart) excludes
        // it. Posted below threshold specifically so it doesn't also trip
        // closeSubscription()'s separate early guard (already covered by
        // EarlyTriggerGuardTest) — this test isolates the commencement-window
        // check in checkTrigger() itself.
        MockUSDC usdc = new MockUSDC();
        TestTriggerConfigurable trig = new TestTriggerConfigurable(address(this), address(this), 365 days);
        trig.postReport(0, bytes32(0));

        CatBond bond = new CatBond(
            address(this), address(this), address(trig), BOND_THRESHOLD, address(usdc),
            uint16(500), 75_000e6, 25_000e6, 1, 30 days,
            "Test Seller", "test-deal-id", new CatBond.ExposureRegion[](0)
        );

        // Must fund to reach Subscription before closeSubscription() will
        // accept a call — no investor deposits are needed to close (the
        // 1-second window just needs to elapse).
        uint256 budget = bond.requiredCouponBudget();
        usdc.mint(address(this), budget + budget * 50 / 10_000);
        usdc.approve(address(bond), budget + budget * 50 / 10_000);
        bond.fundCouponBudget();

        vm.warp(block.timestamp + 2);
        bond.closeSubscription();

        vm.expectRevert(TriggerBase.NoReports.selector);
        bond.checkTrigger();
    }

    function test_Settle_EndToEnd_PaysSponsorFullPrincipal() public {
        (CatBond bond, TestTriggerConfigurable trig, MockUSDC usdc) = _activeBond(365 days);

        vm.warp(bond.activeStart() + 10 days);
        trig.postReport(BOND_THRESHOLD + 30_000_000_000, bytes32(0)); // $400B > $370B

        uint256 sponsorBefore = usdc.balanceOf(address(this));
        bond.settle();
        uint256 received = usdc.balanceOf(address(this)) - sponsorBefore;

        assertEq(received, 25_000e6, "sponsor must receive full investor principal on settle");
        assertEq(uint(bond.status()), uint(CatBond.Status.Triggered), "bond must be Triggered");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SellerInfo — sellerName/dealId read-back, verified access control
// ─────────────────────────────────────────────────────────────────────────────
contract SellerInfoTest is Test {

    address sponsor       = address(0xA1);
    address companyWallet = address(0xA2);
    address investor1     = address(0xB1);
    address stranger      = address(0xCC);

    CatBond bond;

    function setUp() public {
        MockUSDC usdc = new MockUSDC();
        TestTrigger trig = new TestTrigger(companyWallet);

        CatBond.ExposureRegion[] memory exposure = new CatBond.ExposureRegion[](2);
        exposure[0] = CatBond.ExposureRegion({region: "US", pct: 72});
        exposure[1] = CatBond.ExposureRegion({region: "JP", pct: 28});

        bond = new CatBond(
            sponsor, companyWallet, address(trig), 1, address(usdc),
            uint16(500), 50_000e6, 25_000e6, 7 days, 30 days,
            "Raydion", "deal-abc-123", exposure
        );
    }

    function test_ConstructorReadBack_SellerNameAndDealId() public view {
        assertEq(bond.sellerName(), "Raydion", "sellerName must read back exactly what was passed in");
        assertEq(bond.dealId(), "deal-abc-123", "dealId must read back exactly what was passed in");
    }

    function test_ConstructorReadBack_Exposure() public view {
        CatBond.ExposureRegion[] memory got = bond.getExposure();
        assertEq(got.length, 2, "exposure must have exactly the two regions passed in");
        assertEq(got[0].region, "US");
        assertEq(got[0].pct, 72);
        assertEq(got[1].region, "JP");
        assertEq(got[1].pct, 28);
    }

    function test_Exposure_DefaultsEmptyWhenNoneProvided() public {
        MockUSDC usdc2 = new MockUSDC();
        TestTrigger trig2 = new TestTrigger(companyWallet);
        CatBond noExposureBond = new CatBond(
            sponsor, companyWallet, address(trig2), 1, address(usdc2),
            uint16(500), 50_000e6, 25_000e6, 7 days, 30 days,
            "Raydion", "deal-abc-123", new CatBond.ExposureRegion[](0)
        );
        assertEq(noExposureBond.getExposure().length, 0);
    }

    function test_Verified_DefaultsFalse() public view {
        assertFalse(bond.verified(), "verified must default to false on a freshly deployed bond");
    }

    function test_SetVerified_CompanyWalletCanSetTrue() public {
        vm.prank(companyWallet);
        bond.setVerified(true);

        assertTrue(bond.verified(), "verified must flip to true after setVerified(true) by companyWallet");
    }

    function test_SetVerified_CompanyWalletCanRevoke() public {
        vm.prank(companyWallet);
        bond.setVerified(true);
        assertTrue(bond.verified());

        vm.prank(companyWallet);
        bond.setVerified(false);
        assertFalse(bond.verified(), "verified must flip back to false after setVerified(false)");
    }

    function test_SetVerified_RevertsFromSponsor() public {
        vm.prank(sponsor);
        vm.expectRevert(CatBond.NotCompanyWallet.selector);
        bond.setVerified(true);
    }

    function test_SetVerified_RevertsFromInvestor() public {
        vm.prank(investor1);
        vm.expectRevert(CatBond.NotCompanyWallet.selector);
        bond.setVerified(true);
    }

    function test_SetVerified_RevertsFromStranger() public {
        vm.prank(stranger);
        vm.expectRevert(CatBond.NotCompanyWallet.selector);
        bond.setVerified(true);
    }

    /// @dev setVerified() carries no inStatus() modifier — it must work in every
    ///      lifecycle state, since verification is independent of bond status.
    function test_SetVerified_WorksInAnyStatus() public {
        assertEq(uint(bond.status()), uint(CatBond.Status.Funding));
        vm.prank(companyWallet);
        bond.setVerified(true);
        assertTrue(bond.verified(), "setVerified must succeed while bond is still in Funding");
    }
}
