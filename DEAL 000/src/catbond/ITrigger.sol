// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITrigger {
    /// @notice Returns true if the catastrophic event has been confirmed as triggered.
    function isTriggered() external view returns (bool);
}
