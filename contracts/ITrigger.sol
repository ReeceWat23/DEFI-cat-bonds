// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITrigger {
    /// @notice Returns true once the catastrophic event has been confirmed.
    function isTriggered() external view returns (bool);

    /// @notice Loss threshold in whole USD that must be exceeded to fire the trigger.
    function lossLimit() external view returns (uint256);

    /// @notice 0 = IndustryLoss (insured), 1 = EconomicLoss (total).
    function dealType() external view returns (uint8);

    /// @notice Most recently reported loss value (whole USD).
    function reportedValue() external view returns (uint256);

    /// @notice Source string from the most recent report (e.g. "Gallagher Re H1 2026").
    function reportedSource() external view returns (string memory);
}
