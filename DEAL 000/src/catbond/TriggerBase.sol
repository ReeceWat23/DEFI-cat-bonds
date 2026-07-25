// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ITrigger.sol";

/// @title TriggerBase
/// @notice Reference implementation of ITrigger.
///
///   Owner calls report(lossValue, source) with a confirmed industry or economic
///   loss figure. If lossValue >= lossLimit the trigger fires permanently.
///   setTriggered(bool) remains available for manual overrides and corrections.
///
///   Real deal-specific triggers can extend this and override isTriggered() for
///   automated oracle feeds (e.g. Chainlink). For those use cases lossLimit and
///   dealType are still stored for UI display even if the logic doesn't use them.
abstract contract TriggerBase is ITrigger {

    // ── Constants ──────────────────────────────────────────────────────────────
    uint8 public constant INDUSTRY_LOSS = 0;
    uint8 public constant ECONOMIC_LOSS = 1;

    // ── Storage ────────────────────────────────────────────────────────────────
    address public owner;
    bool    internal _triggered;

    uint256 public immutable lossLimit;   // threshold in whole USD
    uint8   public immutable dealType;    // 0 = IndustryLoss, 1 = EconomicLoss

    uint256 public reportedValue;
    string  public reportedSource;

    // ── Errors ─────────────────────────────────────────────────────────────────
    error NotOwner();
    error ZeroLossLimit();

    // ── Events ─────────────────────────────────────────────────────────────────
    event TriggerSet(bool triggered);
    event TriggerReported(uint256 lossValue, string source, bool triggered);

    // ── Modifier ───────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────────

    /// @param _owner     Address authorised to report and override trigger state.
    /// @param _lossLimit Loss threshold in whole USD. Must be > 0.
    /// @param _dealType  0 = IndustryLoss (insured losses), 1 = EconomicLoss (total).
    constructor(address _owner, uint256 _lossLimit, uint8 _dealType) {
        if (_lossLimit == 0) revert ZeroLossLimit();
        owner     = _owner;
        lossLimit = _lossLimit;
        dealType  = _dealType;
    }

    // ── External functions ─────────────────────────────────────────────────────

    /// @notice Submit a confirmed loss figure from an authoritative source.
    ///         If lossValue >= lossLimit the trigger fires permanently.
    ///         Only the owner (company wallet) may call this.
    function report(uint256 lossValue, string calldata source) external onlyOwner {
        reportedValue  = lossValue;
        reportedSource = source;
        if (lossValue >= lossLimit && !_triggered) {
            _triggered = true;
        }
        emit TriggerReported(lossValue, source, _triggered);
    }

    /// @notice Manually override the trigger state.
    ///         Use report() as the primary path; this exists for corrections.
    function setTriggered(bool value) external onlyOwner {
        _triggered = value;
        emit TriggerSet(value);
    }

    /// @inheritdoc ITrigger
    function isTriggered() external view virtual override returns (bool) {
        return _triggered;
    }
}
