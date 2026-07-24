// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ITrigger.sol";

/// @title TriggerBase
/// @notice Reference implementation of ITrigger. Owner can manually flip the trigger.
///         Real deal-specific triggers extend this contract. For example, a FloodTrigger
///         would override isTriggered() to read a Chainlink Data Feed:
///
///         // --- Chainlink integration point ---
///         // AggregatorV3Interface internal _oracle;
///         // function isTriggered() public view override returns (bool) {
///         //     (, int256 answer,,,) = _oracle.latestRoundData();
///         //     return answer >= int256(FLOOD_THRESHOLD);
///         // }
///         // ------------------------------------
abstract contract TriggerBase is ITrigger {
    address public owner;
    bool internal _triggered;

    error NotOwner();

    event TriggerSet(bool triggered);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    /// @notice Manually set the trigger state. Used for testing and manual event confirmation.
    function setTriggered(bool value) external onlyOwner {
        _triggered = value;
        emit TriggerSet(value);
    }

    /// @inheritdoc ITrigger
    function isTriggered() external view virtual override returns (bool) {
        return _triggered;
    }
}
