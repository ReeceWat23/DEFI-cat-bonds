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
///   - Year = 365 days (31,536,000 s). Not 360 or 365.25.
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
    uint256 public constant YEAR_SECONDS         = 365 days;

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
    event TriggerDetected(bool fired);

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

    // -------------------------------------------------------------------------
    // Immutable configuration
    // -------------------------------------------------------------------------

    address public immutable sponsor;
    address public immutable companyWallet;
    ITrigger public immutable trigger;
    IERC20 public immutable usdc;

    uint16  public immutable couponRateBps;
    uint256 public immutable coverageAmount;
    uint256 public immutable minInvestment;
    uint256 public immutable subscriptionDuration;
    uint256 public immutable termDuration;
    uint256 public immutable requiredCouponBudget;

    // -------------------------------------------------------------------------
    // Lifecycle state
    // -------------------------------------------------------------------------

    Status  public status;
    uint256 public subscriptionEnd;
    uint256 public activeStart;
    uint256 public maturity;
    uint256 public settlementTime;

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
    /// @param _trigger           Address of the deployed ITrigger contract.
    /// @param _usdc              USDC contract address.
    /// @param _couponRateBps     Annualised coupon rate in basis points (e.g. 500 = 5%).
    /// @param _coverageAmount    Maximum USDC principal the bond accepts (6-decimal units).
    /// @param _minInvestment     Minimum per-investor deposit (6-decimal units).
    /// @param _subscriptionDuration  Seconds the subscription window stays open after sponsor funds.
    /// @param _termDuration      Seconds from Active start to maturity.
    constructor(
        address  _sponsor,
        address  _companyWallet,
        address  _trigger,
        address  _usdc,
        uint16   _couponRateBps,
        uint256  _coverageAmount,
        uint256  _minInvestment,
        uint256  _subscriptionDuration,
        uint256  _termDuration
    ) {
        sponsor              = _sponsor;
        companyWallet        = _companyWallet;
        trigger              = ITrigger(_trigger);
        usdc                 = IERC20(_usdc);
        couponRateBps        = _couponRateBps;
        coverageAmount       = _coverageAmount;
        minInvestment        = _minInvestment;
        subscriptionDuration = _subscriptionDuration;
        termDuration         = _termDuration;

        // Multiply before dividing; safe for bonds < $1B USDC (see contract-level note).
        requiredCouponBudget = _coverageAmount * _couponRateBps * _termDuration
                               / (BPS_DENOMINATOR * YEAR_SECONDS);

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
        if (_now() < subscriptionEnd) revert SubscriptionStillOpen();

        activeStart = _now();
        maturity    = _now() + termDuration;

        uint256 refund;
        if (totalDeposited < coverageAmount) {
            uint256 unusedCoverage = coverageAmount - totalDeposited;
            refund = unusedCoverage * couponRateBps * termDuration
                     / (BPS_DENOMINATOR * YEAR_SECONDS);
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

        uint256 totalCoupon = principal * couponRateBps * termDuration
                              / (BPS_DENOMINATOR * YEAR_SECONDS);
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
        if (_now() < maturity)     revert NotYetMatured();
        if (trigger.isTriggered()) revert TriggerAlreadyFired();

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
        if (!trigger.isTriggered()) revert TriggerNotFired();

        settlementTime = _now();
        uint256 amount = totalDeposited;

        status = Status.Triggered;
        usdc.safeTransfer(sponsor, amount);

        emit Settled(amount, settlementTime);
    }

    /// @notice View-only: returns trigger state and current bond status.
    function triggerStatus() external view returns (bool fired, Status currentStatus) {
        fired         = trigger.isTriggered();
        currentStatus = status;
    }

    /// @notice Non-view companion to triggerStatus(). Emits TriggerDetected if the trigger
    ///         has fired but the bond is not yet settled. Off-chain monitors call this
    ///         periodically to get an on-chain event when the trigger flips.
    function pingTrigger() external {
        bool fired = trigger.isTriggered();
        if (fired && status == Status.Active) {
            emit TriggerDetected(fired);
        }
    }

    // -------------------------------------------------------------------------
    // Internal utilities
    // -------------------------------------------------------------------------

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
