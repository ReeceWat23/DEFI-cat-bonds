// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITrigger
/// @notice The on-chain source of truth for a trigger: an append-only report
///         log, not a triggered flag. There is deliberately no isTriggered()
///         or setTriggered() here — "triggered" is computed by the caller
///         (CatBond.checkTrigger()) by comparing a report's value against
///         its own threshold, not stored on the trigger itself. See the
///         sprint plan `api/it3_plan_triggers_n_mgmnt.md` §2.4.
interface ITrigger {
    /// @notice One posted report. `monitorRef` ties it back to the specific
    ///         off-chain monitor-buffer entry it was derived from (the hash
    ///         of that entry's raw API response) — every on-chain report
    ///         must be traceable to a monitor entry, never a live API call
    ///         made at report time.
    struct Report {
        uint256 value;
        uint256 reportedAt;
        address reporter;
        bytes32 monitorRef;
    }

    /// @notice Number of reports ever posted. Used to check for an empty
    ///         report log before calling latestReport(), which reverts.
    function reportCount() external view returns (uint256);

    /// @notice The single most recent report, regardless of age. Reverts if
    ///         no report has ever been posted.
    function latestReport() external view returns (Report memory);

    /// @notice The most recent report with `reportedAt >= notBefore`.
    ///         Reverts if none exists — a missing report must block a
    ///         caller like CatBond.checkTrigger(), never silently default
    ///         to "not triggered."
    function latestReportSince(uint256 notBefore) external view returns (Report memory);

    /// @notice Age, in seconds, past which a report can no longer be used
    ///         to settle a bond. Snapshotted from the product definition at
    ///         trigger deploy time.
    function maxReportAge() external view returns (uint256);
}
