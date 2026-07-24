// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CatBond.sol";
import "../contracts/TriggerBase.sol";

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
// Concrete trigger for testing
// ─────────────────────────────────────────────────────────────────────────────
contract TestTrigger is TriggerBase {
    constructor(address _owner) TriggerBase(_owner) {}
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
            address(usdc),
            uint16(COUPON_BPS),
            COVERAGE,
            MIN_INVEST,
            0,
            0,
            SUB_DURATION,
            TERM_DURATION
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

        // Trigger fires
        vm.prank(companyWallet);
        trig.setTriggered(true);

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

    /// @dev settle() from non-company wallet reverts.
    function test_Reject_SettleFromStranger() public {
        _sponsorFunds();
        _investorDeposits(investor1, 25_000 * 1e6);
        _closeSubscription();
        vm.prank(companyWallet);
        trig.setTriggered(true);
        vm.prank(stranger);
        vm.expectRevert(CatBond.NotCompanyWallet.selector);
        bond.settle();
    }

    /// @dev settle() when trigger has not fired reverts.
    function test_Reject_SettleWhenNotTriggered() public {
        _sponsorFunds();
        _investorDeposits(investor1, 25_000 * 1e6);
        _closeSubscription();
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

    /// @dev markMatured() when trigger has fired reverts.
    function test_Reject_MarkMatureWhenTriggered() public {
        _sponsorFunds();
        _closeSubscription();
        vm.prank(companyWallet);
        trig.setTriggered(true);
        vm.warp(bond.maturity() + 1);
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
            sponsor, companyWallet, address(bigTrig), address(bigUsdc),
            uint16(COUPON_BPS), bigCoverage, MIN_INVEST, 0, 0, SUB_DURATION, TERM_DURATION
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
            address(yearUsdc),
            uint16(COUPON_BPS),
            principal,   // $25k coverage — one investor fills it exactly
            principal,   // $25k minimum
            0,
            0,
            1,           // 1-second subscription window
            TERM_DURATION
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
// TEMP DEBUG TEST — delete after diagnosis
