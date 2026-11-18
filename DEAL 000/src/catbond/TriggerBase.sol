// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ITrigger.sol";

/// @title TriggerBase
/// @notice Reference implementation of ITrigger — an append-only report log
///         tied to a frozen snapshot of a product definition (see
///         api/products/), not a triggered flag.
///
///   The `reporter` role (initially the company wallet, per sprint plan
///   §2.4 / Q2) calls postReport(value, monitorRef) whenever the off-chain
///   monitor has a fresh confirmed figure. Every report is kept — nothing
///   is overwritten, nothing latches permanently. Whether a given bond
///   considers itself "triggered" is computed by that bond
///   (CatBond.checkTrigger()) comparing the latest valid report's value
///   against its own threshold; the trigger itself has no opinion on
///   thresholds at all, which is what lets multiple bonds with different
///   thresholds share one trigger/product.
///
///   `dealType`/`lossLimit` from the previous design are gone: which
///   metric a trigger reports on (economic-loss vs. industry-loss) is now
///   encoded in `productConfig.valuePath`, snapshotted from
///   api/products/*.json at deploy time — see that folder's README for
///   the "one endpoint, multiple metrics" design.
abstract contract TriggerBase is ITrigger {

    // ── Storage ────────────────────────────────────────────────────────────────

    /// @dev Frozen at deploy — describes which product/metric/endpoint this
    ///      trigger reports on. `endpointHash` is keccak256 of the endpoint
    ///      URL (not stored raw) — enough to detect drift if the product's
    ///      underlying endpoint changes without a version bump.
    struct ProductConfig {
        string  productId;
        uint256 version;
        string  valuePath;
        string  units;
        uint256 maxReportAge;   // seconds
        bytes32 endpointHash;
    }

    address public owner;
    address public reporter;

    ProductConfig public productConfig;
    Report[] public reports;

    // ── Errors ─────────────────────────────────────────────────────────────────
    error NotOwner();
    error NotReporter();
    error ZeroAddress();
    error NoReports();

    // ── Events ─────────────────────────────────────────────────────────────────
    event ReporterSet(address indexed reporter);
    event ReportPosted(uint256 value, uint256 reportedAt, address indexed reporter, bytes32 monitorRef);

    // ── Modifiers ──────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyReporter() {
        if (msg.sender != reporter) revert NotReporter();
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────────

    /// @param _owner        Address authorised to change the reporter role.
    /// @param _reporter     Address authorised to post reports. Initially the
    ///                      company wallet (single wallet for now, per Q2 —
    ///                      multisig is a future upgrade via setReporter()).
    /// @param _productId    api/products/ product_id this trigger snapshots.
    /// @param _version      That product's version at deploy time.
    /// @param _valuePath    Which of that product's value_paths this trigger
    ///                      reports on — the deal-type/peril selection.
    /// @param _units        Units of the value at _valuePath.
    /// @param _maxReportAge Seconds; a report older than this can't settle a bond.
    /// @param _endpoint     The product's endpoint URL — hashed and stored,
    ///                      never kept raw on-chain.
    constructor(
        address _owner,
        address _reporter,
        string memory _productId,
        uint256 _version,
        string memory _valuePath,
        string memory _units,
        uint256 _maxReportAge,
        string memory _endpoint
    ) {
        if (_owner == address(0) || _reporter == address(0)) revert ZeroAddress();
        owner    = _owner;
        reporter = _reporter;
        productConfig = ProductConfig({
            productId:    _productId,
            version:      _version,
            valuePath:    _valuePath,
            units:        _units,
            maxReportAge: _maxReportAge,
            endpointHash: keccak256(bytes(_endpoint))
        });
    }

    // ── External functions ─────────────────────────────────────────────────────

    /// @notice Change who may post reports. Owner-only. This is what lets an
    ///         oracle network be swapped in later with one call, per §2.4 —
    ///         not built for in this sprint (§0.5), but the door stays open.
    function setReporter(address _reporter) external onlyOwner {
        if (_reporter == address(0)) revert ZeroAddress();
        reporter = _reporter;
        emit ReporterSet(_reporter);
    }

    /// @notice Append a confirmed value from the off-chain monitor.
    ///         `monitorRef` is the hash of the specific monitor-buffer entry
    ///         this report was derived from — never posted from a live API
    ///         call made at report time. Reporter-only.
    function postReport(uint256 value, bytes32 monitorRef) external onlyReporter {
        reports.push(Report({value: value, reportedAt: block.timestamp, reporter: msg.sender, monitorRef: monitorRef}));
        emit ReportPosted(value, block.timestamp, msg.sender, monitorRef);
    }

    /// @inheritdoc ITrigger
    function reportCount() external view returns (uint256) {
        return reports.length;
    }

    /// @inheritdoc ITrigger
    function latestReport() external view returns (Report memory) {
        if (reports.length == 0) revert NoReports();
        return reports[reports.length - 1];
    }

    /// @inheritdoc ITrigger
    /// @dev Reports are appended in non-decreasing block.timestamp order, so
    ///      the single latest report is always the one with the greatest
    ///      reportedAt. That means "the most recent report with
    ///      reportedAt >= notBefore" is simply the latest report, if its
    ///      timestamp clears the bar — no search needed.
    function latestReportSince(uint256 notBefore) external view returns (Report memory) {
        if (reports.length == 0) revert NoReports();
        Report memory r = reports[reports.length - 1];
        if (r.reportedAt < notBefore) revert NoReports();
        return r;
    }

    /// @inheritdoc ITrigger
    function maxReportAge() external view returns (uint256) {
        return productConfig.maxReportAge;
    }
}
