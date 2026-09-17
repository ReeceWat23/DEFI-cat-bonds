// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/RDX.sol";
import "catbond/TriggerBase.sol";
import "catbond/CatBond.sol";

/// @dev Concrete trigger for DEAL 000. Reports economic-loss or industry-loss
///      figures (selected by which valuePath it's deployed with) from the
///      api/products/public/natcat_loss.v2.json product — see that file and
///      api/products/README.md for the full definition this snapshots.
contract Deal000Trigger is TriggerBase {
    constructor(
        address _owner,
        address _reporter,
        string memory _productId,
        uint256 _version,
        string memory _valuePath,
        string memory _units,
        uint256 _maxReportAge,
        string memory _endpoint
    ) TriggerBase(_owner, _reporter, _productId, _version, _valuePath, _units, _maxReportAge, _endpoint) {}
}

/// @notice Full local deployment for DEAL 000 end-to-end testing.
///
///   Run via run.sh (default 3-day term):
///     ./run.sh
///
///   Run quick maturity scenario (5-min term, 1-min subscription):
///     ./run.sh quick
///
contract Setup is Script {

    // ── Test wallets ──────────────────────────────────────────────────────────
    address constant COMPANY  = 0xE1ea925Bc3Ef4706ca6a22E72FC83828098377B9;
    address constant SPONSOR  = 0x9106ca8aEA4dbd6C4885b535a70632C6D7610220;
    address constant INVESTOR = 0x923F2DAdB7D38d8Dd4629dFD1027537EaA722D66;

    // ── Fixed bond parameters ─────────────────────────────────────────────────
    uint16  constant COUPON_BPS  = 800;           // 8% flat on total coverage
    uint256 constant COVERAGE    = 500_000e6;     // $500,000 RDX max principal
    uint256 constant MIN_INVEST  = 50_000e6;      // $50,000 RDX min per investor

    // ── Funding amounts ───────────────────────────────────────────────────────
    uint256 constant ETH_PER_WALLET = 2 ether;
    uint256 constant RDX_PER_WALLET = 100_000_000e6; // 100M RDX

    function run() external {
        // Read scenario from env — set by run.sh based on the CLI argument.
        // QUICK=1  → 1-min subscription, 5-min term (maturity path testing)
        // QUICK=0  → 1-hour subscription, 3-day term  (default)
        bool quick = vm.envOr("QUICK", uint256(0)) == 1;

        uint256 subDuration  = quick ? 60        : 3_600;      // 1 min  vs 1 hour
        uint256 termDuration = quick ? 5 minutes : 3 days;     // 5 min  vs 3 days

        // Set by run.sh once the web2 Deal store record has been created —
        // this is the bidirectional link (Deal Page - Dynamic Data v2, §3.3).
        // Empty string is a valid "no web2 record yet" placeholder for
        // standalone local runs.
        string memory dealId = vm.envOr("DEAL_ID", string(""));

        // TRIGGER_TYPE: 0 = Industry (insured) loss, 1 = Economic (total) loss.
        // LOSS_THRESHOLD_B: threshold in billions of USD. Defaults match the
        // original DEAL 000 fixture (economic loss, $370B). Threshold now
        // lives on CatBond itself, not the trigger — see CatBond.sol's
        // `threshold` field and checkTrigger().
        uint8   dealType    = uint8(vm.envOr("TRIGGER_TYPE", uint256(1)));
        uint256 thresholdB  = vm.envOr("LOSS_THRESHOLD_B", uint256(370));
        uint256 threshold   = thresholdB * 1_000_000_000;

        // Snapshotted from api/products/public/natcat_loss.v2.json — see
        // that file and api/products/README.md's "one endpoint, multiple
        // metrics" design. dealType selects which of the product's two
        // metrics this trigger reports on; the string below is just that
        // metric's primary (full-year total) field for on-chain
        // identification — the monitor resolves the real value off-chain
        // with a total→quarterly fallback chain (v2's value_paths).
        string memory valuePath = dealType == 1
            ? "response.reports.\"economic-loss | total\""
            : "response.reports.\"industry-loss | total\"";
        uint256 maxReportAge = 150 days; // matches the product's max_report_age (150 days)

        vm.startBroadcast();

        // 1 — Deploy RDX stablecoin
        RDX rdx = new RDX(msg.sender);

        // 2 — Mint 100M RDX to every test wallet
        rdx.mint(COMPANY,  RDX_PER_WALLET);
        rdx.mint(SPONSOR,  RDX_PER_WALLET);
        rdx.mint(INVESTOR, RDX_PER_WALLET);

        // 3 — Fund every test wallet with ETH for gas
        (bool ok1,) = payable(COMPANY).call{value: ETH_PER_WALLET}("");
        (bool ok2,) = payable(SPONSOR).call{value: ETH_PER_WALLET}("");
        (bool ok3,) = payable(INVESTOR).call{value: ETH_PER_WALLET}("");
        require(ok1 && ok2 && ok3, "ETH transfer failed");

        // 4 — Deploy trigger. Company wallet is both owner and reporter for
        // now (single wallet, per the sprint's Q2 — multisig is a future
        // setReporter() call, not built here).
        Deal000Trigger trigger = new Deal000Trigger(
            COMPANY,
            COMPANY,
            "natcat_loss",
            2,
            valuePath,
            "usd_billions",
            maxReportAge,
            "https://realestatesimplified.xyz/version-test/api/1.1/wf/latest-report"
        );

        // Canonical Raydion exposure breakdown (Plan-it-2 dealpage doc §4.1),
        // small enough to hold on-chain: region + percentage points.
        CatBond.ExposureRegion[] memory exposure = new CatBond.ExposureRegion[](4);
        exposure[0] = CatBond.ExposureRegion({region: "US", pct: 50});
        exposure[1] = CatBond.ExposureRegion({region: "China", pct: 30});
        exposure[2] = CatBond.ExposureRegion({region: "Brazil", pct: 15});
        exposure[3] = CatBond.ExposureRegion({region: "EU", pct: 5});

        // 5 — Deploy CatBond
        CatBond bond = new CatBond(
            SPONSOR,
            COMPANY,
            address(trigger),
            threshold,
            address(rdx),
            COUPON_BPS,
            COVERAGE,
            MIN_INVEST,
            subDuration,
            termDuration,
            "Raydion",
            dealId,
            exposure
        );

        vm.stopBroadcast();

        // ── Output ────────────────────────────────────────────────────────────
        uint256 budget        = bond.requiredCouponBudget();
        uint256 budgetWithFee = (budget * 10_050) / 10_000;

        console2.log("");
        console2.log("============================================================");
        if (quick) {
            console2.log("          DEAL 000 - QUICK SCENARIO (maturity test)         ");
            console2.log("          Subscription: 1 min  |  Term: 5 min               ");
        } else {
            console2.log("               DEAL 000 - Anvil Deployment                  ");
            console2.log("          Subscription: 1 hour  |  Term: 3 days             ");
        }
        console2.log("============================================================");
        console2.log("");
        console2.log("  RDX Token:      ", address(rdx));
        console2.log("  ManualTrigger:  ", address(trigger));
        console2.log("  CatBond:        ", address(bond));
        console2.log("");
        console2.log("  --- Bond Parameters ---");
        console2.log("  Coverage:         $500,000 RDX");
        console2.log("  Min Investment:   $50,000  RDX");
        console2.log("  Coupon Rate:      8% flat on total coverage (800 BPS)");
        if (quick) {
            console2.log("  Subscription:     1 minute");
            console2.log("  Term:             5 minutes");
        } else {
            console2.log("  Subscription:     1 hour");
            console2.log("  Term:             3 days");
        }
        console2.log("");
        console2.log("  --- Sponsor Must Approve Before Funding ---");
        console2.log("  Coupon budget:   ", budget,        "(6-dec RDX)");
        console2.log("  + 0.5% fee:      ", budgetWithFee, "(6-dec RDX total)");
        console2.log("  Approve this to: ", address(bond));
        console2.log("");
        console2.log("  --- Test Wallets (each: 2 ETH + 100M RDX) ---");
        console2.log("  Company / Settler:  ", COMPANY);
        console2.log("  Sponsor:            ", SPONSOR);
        console2.log("  Investor:           ", INVESTOR);
        console2.log("");
        console2.log("  Paste CatBond + ManualTrigger addresses into the UI.");
        console2.log("  Admin page -> Manage, then use Deal Page to invest.");
        console2.log("============================================================");
        console2.log("");
    }
}
