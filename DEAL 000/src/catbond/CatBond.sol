// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ITrigger.sol";


/// @title CatBond — On-chain Catastrophe Bond
/// @notice Sponsor deposits a coupon budget; investors deposit principal. If the trigger
///         event fires the sponsor receives all principal. If it does not, investors
///         receive their principal back at maturity plus pro-rata coupon throughout.
///
/// Assumptions / design choices:
///   - couponRateBps is a flat rate on principal for the full term (not annualised).
///     e.g. 800 BPS = 8% of principal paid over the bond's lifetime, vesting per-second.
///   - Intermediate coupon math multiplies before dividing; no SafeMath needed in 0.8+.
///     Bonds < $1B USDC will not overflow uint256 in any intermediate step.
///   - All amounts in USDC (6 decimals). No ETH held.
///   - Pull-based payments only. Contract never iterates the investors array.
///   - _now() is virtual so a test harness can override it without vm.warp.
contract CatBond is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 public constant ORIGINATION_FEE_BPS = 50;   // 0.5%
    uint256 public constant BPS_DENOMINATOR      = 10_000;

    // -------------------------------------------------------------------------
    // Lifecycle enum
    // -------------------------------------------------------------------------

    enum Status { Funding, Subscription, Active, Matured, Triggered }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event SponsorFunded(uint256 principalAmount, uint256 feeAmount, uint256 subscriptionEnd);
    event Deposited(address indexed investor, uint256 accepted, uint256 feeAmount, uint256 totalDeposited);
    event SubscriptionClosed(uint256 totalDeposited, uint256 unusedCouponRefund);
    event CouponClaimed(address indexed investor, uint256 amount);
    event PrincipalWithdrawn(address indexed investor, uint256 amount);
    event BondMatured(uint256 timestamp);
    event Settled(uint256 amountToSponsor, uint256 settlementTime);
    event SellerVerified(bool verified);
    event TriggerChecked(uint256 value, uint256 reportedAt, bool triggered);

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error NotSponsor();
    error NotCompanyWallet();
    error WrongStatus(Status required, Status actual);
    error SubscriptionStillOpen();
    error SubscriptionExpired();
    error BelowMinInvestment();
    error ExceedsMaxAccepted();
    error NothingToClaim();
    error AlreadyWithdrawn();
    error TriggerNotFired();
    error TriggerAlreadyFired();
    error NotInvestor();
    error NotYetMatured();
    error ConflictOfInterest();
    error ZeroTrigger();
    error InvalidTrigger();
    error StaleReport();

    // -------------------------------------------------------------------------
    // Immutable configuration
    // -------------------------------------------------------------------------

    address public immutable sponsor;
    address public immutable companyWallet;
    ITrigger public immutable trigger;
    uint256 public immutable threshold;   // whole USD; this bond's own trigger threshold
    IERC20 public immutable usdc;

    uint16  public immutable couponRateBps;
    uint256 public immutable coverageAmount;
    uint256 public immutable minInvestment;
    uint256 public immutable subscriptionDuration;
    uint256 public immutable termDuration;
    uint256 public immutable requiredCouponBudget;

    // -------------------------------------------------------------------------
    // Seller info — deliberately minimal on-chain. Domicile, entity type,
    // description, and loss history all live in the Bubble Deal store;
    // dealId is the link to that record (Deal Page — Dynamic Data v2, §3.3).
    // sellerName is a cheap, useful bit of on-chain identity; verified is
    // set post-deploy, off-platform, by the company wallet — never at
    // construction. Exposure is small structured data (a handful of
    // region/percentage pairs from the build-a-bond workshop's SOV step),
    // not a heavy file like loss history, so it lives on-chain too —
    // finalized before "Post deal" the same way the rest of the deal terms
    // are, and immutable for the same reason.
    // -------------------------------------------------------------------------

    string public sellerName;
    string public dealId;
    bool   public verified;

    /// @dev Mirrors the workshop's SOV region breakdown, e.g. {region: "US", pct: 72}.
    struct ExposureRegion {
        string region;
        uint16 pct;   // percentage points, 0-100
    }

    ExposureRegion[] public exposure;

    // -------------------------------------------------------------------------
    // Lifecycle state
    // -------------------------------------------------------------------------

    Status  public status;
    uint256 public subscriptionEnd;
    uint256 public activeStart;   // also this bond's "commencement" — the earliest a report may date from
    uint256 public maturity;
    uint256 public settlementTime;

    /// @dev Written by checkTrigger() every time it runs. `checkedBy` is
    ///      whoever called checkTrigger() (anyone may), not necessarily the
    ///      reporter — this is a record of when/by-whom the bond last looked,
    ///      not who supplied the underlying report.
    struct LastCheck {
        uint256 value;
        uint256 reportedAt;
        bool    triggered;
        uint256 checkedAt;
        address checkedBy;
    }

    LastCheck public lastCheck;

    // -------------------------------------------------------------------------
    // Accounting
    // -------------------------------------------------------------------------

    uint256 public totalDeposited;
    mapping(address => uint256) public principalOf;
    mapping(address => uint256) public alreadyClaimed;
    mapping(address => bool)    public principalWithdrawn;
    address[] public investors;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlySponsor() {
        if (msg.sender != sponsor) revert NotSponsor();
        _;
    }

    modifier onlyCompanyWallet() {
        if (msg.sender != companyWallet) revert NotCompanyWallet();
        _;
    }

    modifier inStatus(Status required) {
        if (status != required) revert WrongStatus(required, status);
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _sponsor           Wallet that funds and (if triggered) receives principal.
    /// @param _companyWallet     Only address authorised to call settle() and markMatured().
    /// @param _trigger           Address of the deployed ITrigger contract. Must be non-zero
    ///                           and must implement ITrigger — checked at deploy, see below.
    /// @param _threshold         This bond's own trigger threshold, whole USD. Compared against
    ///                           the trigger's reported value by checkTrigger() — the trigger
    ///                           itself has no threshold, which is what lets multiple bonds
    ///                           share one trigger/product at different thresholds.
    /// @param _usdc              USDC contract address.
    /// @param _couponRateBps     Flat coupon rate in basis points for the full term (e.g. 800 = 8% of principal).
    /// @param _coverageAmount    Maximum USDC principal the bond accepts (6-decimal units).
    /// @param _minInvestment     Minimum per-investor deposit (6-decimal units).
    /// @param _subscriptionDuration  Seconds the subscription window stays open after sponsor funds.
    /// @param _termDuration      Seconds from Active start to maturity.
    /// @param _sellerName        Seller/sponsor display name (e.g. "Raydion").
    /// @param _dealId            The web2 Deal store's record id for this bond — the bidirectional link.
    /// @param _exposure          Region/percentage breakdown from the workshop's SOV step (e.g. [("US", 72), ("JP", 28)]).
    constructor(
        address  _sponsor,
        address  _companyWallet,
        address  _trigger,
        uint256  _threshold,
        address  _usdc,
        uint16   _couponRateBps,
        uint256  _coverageAmount,
        uint256  _minInvestment,
        uint256  _subscriptionDuration,
        uint256  _termDuration,
        string memory _sellerName,
        string memory _dealId,
        ExposureRegion[] memory _exposure
    ) {
        if (_trigger == address(0)) revert ZeroTrigger();
        if (_trigger.code.length == 0) revert InvalidTrigger();
        // A conforming ITrigger always answers reportCount(), even with zero
        // reports posted yet — a non-conforming contract (or an EOA, caught
        // by the code-length check above) fails to decode a return value and
        // lands in the catch clause.
        try ITrigger(_trigger).reportCount() returns (uint256) {} catch { revert InvalidTrigger(); }

        sponsor              = _sponsor;
        companyWallet        = _companyWallet;
        trigger              = ITrigger(_trigger);
        threshold            = _threshold;
        usdc                 = IERC20(_usdc);
        couponRateBps        = _couponRateBps;
        coverageAmount       = _coverageAmount;
        sellerName           = _sellerName;
        dealId               = _dealId;
        minInvestment        = _minInvestment;
        subscriptionDuration = _subscriptionDuration;
        termDuration         = _termDuration;

        for (uint256 i = 0; i < _exposure.length; i++) {
            exposure.push(_exposure[i]);
        }

        // Flat rate on full coverage; vesting is time-proportional during the term.
        requiredCouponBudget = _coverageAmount * _couponRateBps / BPS_DENOMINATOR;

        status = Status.Funding;
    }

    // -------------------------------------------------------------------------
    // Time abstraction — override in test harness to avoid vm.warp / archive nodes
    // -------------------------------------------------------------------------

    /// @dev Returns the current timestamp. Virtual so CatBondHarness can inject mock time.
    function _now() internal view virtual returns (uint256) {
        return block.timestamp;
    }

    // -------------------------------------------------------------------------
    // Internal helper
    // -------------------------------------------------------------------------

    /// @dev Pulls principalAmount + fee from `from`. Fee goes to companyWallet.
    ///      Both fundCouponBudget and deposit use this so the fee logic lives in one place.
    function _collectWithFee(address from, uint256 principalAmount) internal returns (uint256 fee) {
        fee = principalAmount * ORIGINATION_FEE_BPS / BPS_DENOMINATOR;
        usdc.safeTransferFrom(from, companyWallet, fee);
        usdc.safeTransferFrom(from, address(this), principalAmount);
    }

    // -------------------------------------------------------------------------
    // External functions
    // -------------------------------------------------------------------------

    /// @notice Sponsor deposits the coupon budget, opening the subscription window.
    ///         Sponsor must approve at least requiredCouponBudget * 1.005 USDC first.
    function fundCouponBudget()
        external
        onlySponsor
        inStatus(Status.Funding)
        nonReentrant
    {
        subscriptionEnd = _now() + subscriptionDuration;

        uint256 fee = _collectWithFee(sponsor, requiredCouponBudget);

        status = Status.Subscription;
        emit SponsorFunded(requiredCouponBudget, fee, subscriptionEnd);
    }

    /// @notice Investor deposits principal into the bond.
    /// @param amount       Desired principal to deposit (6-decimal USDC).
    /// @param maxAccepted  Maximum principal the investor consents to having accepted.
    ///                     Pass amount for all-or-nothing; or less to guard against partial fills.
    function deposit(uint256 amount, uint256 maxAccepted)
        external
        inStatus(Status.Subscription)
        nonReentrant
    {
        if (msg.sender == sponsor || msg.sender == companyWallet) revert ConflictOfInterest();
        if (_now() >= subscriptionEnd) revert SubscriptionExpired();

        uint256 remaining = coverageAmount - totalDeposited;
        uint256 accepted  = amount < remaining ? amount : remaining;

        if (accepted < minInvestment)  revert BelowMinInvestment();
        if (accepted > maxAccepted)    revert ExceedsMaxAccepted();

        if (principalOf[msg.sender] == 0) {
            investors.push(msg.sender);
        }

        uint256 fee = _collectWithFee(msg.sender, accepted);

        principalOf[msg.sender] += accepted;
        totalDeposited          += accepted;

        emit Deposited(msg.sender, accepted, fee, totalDeposited);
    }

    /// @notice Closes the subscription window and starts the Active phase.
    ///         Callable by anyone once subscriptionEnd has passed.
    ///         Refunds unused coupon budget to sponsor if the bond is undersubscribed.
    function closeSubscription()
        external
        inStatus(Status.Subscription)
        nonReentrant
    {
        bool fullySubscribed = totalDeposited >= coverageAmount;
        if (_now() < subscriptionEnd && !fullySubscribed) revert SubscriptionStillOpen();

        // Early guard: activeStart (this bond's "commencement") isn't set
        // yet, so checkTrigger()'s latestReportSince() window doesn't apply
        // here. Instead, just ask whether the trigger's latest known report
        // — regardless of when it was posted — already clears this bond's
        // threshold. A missing report log (reportCount() == 0) is not a
        // problem here the way it is for checkTrigger(): nothing has ever
        // been reported, so there's nothing to guard against.
        if (trigger.reportCount() > 0) {
            ITrigger.Report memory r = trigger.latestReport();
            if (r.value >= threshold) revert TriggerAlreadyFired();
        }

        activeStart = _now();
        maturity    = _now() + termDuration;

        uint256 refund;
        if (totalDeposited < coverageAmount) {
            uint256 unusedCoverage = coverageAmount - totalDeposited;
            refund = unusedCoverage * couponRateBps / BPS_DENOMINATOR;
            usdc.safeTransfer(sponsor, refund);
        }

        status = Status.Active;
        emit SubscriptionClosed(totalDeposited, refund);
    }

    /// @notice Investor claims any coupon that has vested since their last claim.
    ///         Valid in Active (vesting up to maturity) and Triggered (vesting up to settlementTime).
    function claimCoupon() external nonReentrant {
        if (status != Status.Active && status != Status.Triggered) {
            revert WrongStatus(Status.Active, status);
        }

        uint256 principal = principalOf[msg.sender];
        if (principal == 0) revert NotInvestor();

        uint256 vestingEnd = (status == Status.Triggered) ? settlementTime : maturity;
        uint256 elapsed    = _min(_now(), vestingEnd) - activeStart;

        uint256 totalCoupon = principal * couponRateBps / BPS_DENOMINATOR;
        uint256 vested      = totalCoupon * elapsed / termDuration;
        uint256 claimable   = vested - alreadyClaimed[msg.sender];

        if (claimable == 0) revert NothingToClaim();

        alreadyClaimed[msg.sender] += claimable;
        usdc.safeTransfer(msg.sender, claimable);

        emit CouponClaimed(msg.sender, claimable);
    }

    /// @notice Company wallet advances the bond to Matured after the term ends.
    ///         Rationale: serves as a human review checkpoint before principal withdrawal —
    ///         guards against edge cases like a trigger oracle about to flip true at maturity
    ///         boundary, or a misbehaving trigger contract.
    ///         Investors must be informed at onboarding that withdrawal is gated on this call.
    function markMatured()
        external
        onlyCompanyWallet
        inStatus(Status.Active)
    {
        if (_now() < maturity) revert NotYetMatured();
        // checkTrigger() reverts if there's no valid report in window — a
        // missed report blocks this exactly like it blocks settle(), rather
        // than silently defaulting to "not triggered." See §2.5: the
        // company wallet keeping reports fresh is the operational tradeoff
        // this sprint takes on instead of paying an oracle network.
        if (checkTrigger()) revert TriggerAlreadyFired();

        status = Status.Matured;
        emit BondMatured(_now());
    }

    /// @notice Investor withdraws their full principal. Only valid after markMatured().
    function withdrawPrincipal()
        external
        inStatus(Status.Matured)
        nonReentrant
    {
        uint256 principal = principalOf[msg.sender];
        if (principal == 0)                     revert NotInvestor();
        if (principalWithdrawn[msg.sender])     revert AlreadyWithdrawn();

        principalWithdrawn[msg.sender] = true;
        usdc.safeTransfer(msg.sender, principal);

        emit PrincipalWithdrawn(msg.sender, principal);
    }

    /// @notice Company wallet confirms trigger has fired and transfers all principal to sponsor.
    ///         Coupon budget remains so investors can still claim vested coupon up to settlementTime.
    function settle()
        external
        onlyCompanyWallet
        inStatus(Status.Active)
        nonReentrant
    {
        // checkTrigger() reverts on a stale/missing report — settle()
        // deliberately does not catch that and fall back to "not
        // triggered." A missed report must block settlement, full stop.
        if (!checkTrigger()) revert TriggerNotFired();

        settlementTime = _now();
        uint256 amount = totalDeposited;

        status = Status.Triggered;
        usdc.safeTransfer(sponsor, amount);

        emit Settled(amount, settlementTime);
    }

    /// @notice Returns the full exposure breakdown in one call — the auto-generated
    ///         `exposure(uint256)` getter only returns one region at a time.
    function getExposure() external view returns (ExposureRegion[] memory) {
        return exposure;
    }

    /// @notice The one path by which this bond decides whether it's
    ///         triggered. Callable by anyone (e.g. a "self-check" button on
    ///         the bond health view, sprint plan §2.6) — reading trigger
    ///         state costs the caller gas, not the contract, and there's no
    ///         state it would be harmful for an outsider to refresh.
    ///
    ///         Reads the trigger's latest report no older than activeStart
    ///         (this bond's commencement), reverts if none exists or if it's
    ///         older than the trigger's own max_report_age, compares its
    ///         value against this bond's threshold, and records the result.
    ///         settle() and markMatured() both call this and do not catch a
    ///         revert here — a stale or missing report blocks either path,
    ///         never silently resolves to "not triggered."
    function checkTrigger() public returns (bool triggeredNow) {
        ITrigger.Report memory r = trigger.latestReportSince(activeStart);
        if (_now() > r.reportedAt + trigger.maxReportAge()) revert StaleReport();

        triggeredNow = r.value >= threshold;
        lastCheck = LastCheck({
            value:      r.value,
            reportedAt: r.reportedAt,
            triggered:  triggeredNow,
            checkedAt:  _now(),
            checkedBy:  msg.sender
        });

        emit TriggerChecked(r.value, r.reportedAt, triggeredNow);
    }

    /// @notice Grants or revokes the RHODEX verification stamp. Off-platform and manual —
    ///         sponsors request it out of band; this is never a self-serve toggle. Callable
    ///         in any lifecycle state, independent of bond status.
    function setVerified(bool _verified) external onlyCompanyWallet {
        verified = _verified;
        emit SellerVerified(_verified);
    }

    // -------------------------------------------------------------------------
    // Internal utilities
    // -------------------------------------------------------------------------

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
