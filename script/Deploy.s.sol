// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/TriggerBase.sol";
import "../contracts/CatBond.sol";

// Concrete trigger for deployment — owner can manually flip it.
// Replace with your deal-specific trigger (FloodTrigger, DroughtTrigger, etc.)
contract ManualTrigger is TriggerBase {
    constructor(address _owner) TriggerBase(_owner) {}
}

/// @notice Deploys a CatBond with a ManualTrigger.
///
/// Usage:
///   forge script script/Deploy.s.sol \
///     --rpc-url $RPC_URL \
///     --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY
///
/// Required env vars (set in .env or export before running):
///   SPONSOR          — address that funds the bond and receives principal if triggered
///   COMPANY_WALLET   — address that can call settle() and markMatured()
///   USDC_ADDRESS     — USDC contract on the target network
///
/// Optional overrides (defaults below match the $75k demo bond):
///   COUPON_BPS           — flat coupon rate in basis points (default 500 = 5% of coverage)
///   COVERAGE_AMOUNT      — max USDC principal, 6-decimal (default 75_000e6 = $75k)
///   MIN_INVESTMENT       — minimum per investor, 6-decimal (default 25_000e6 = $25k)
///   INDUSTRY_LOSS_LIMIT  — industry insured loss trigger threshold in USD (default 0 = unset)
///   ECONOMIC_LOSS_LIMIT  — total economic loss trigger threshold in USD (default 0 = unset)
///   SUBSCRIPTION_SECONDS — subscription window length (default 604800 = 7 days)
///   TERM_SECONDS         — bond term length (default 31536000 = 365 days)
contract DeployScript is Script {
    function run() external {
        address sponsor        = vm.envAddress("SPONSOR");
        address companyWallet  = vm.envAddress("COMPANY_WALLET");
        address usdcAddress    = vm.envAddress("USDC_ADDRESS");

        uint16  couponBps         = uint16(vm.envOr("COUPON_BPS",           uint256(500)));
        uint256 coverage          = vm.envOr("COVERAGE_AMOUNT",             uint256(75_000e6));
        uint256 minInvestment     = vm.envOr("MIN_INVESTMENT",              uint256(25_000e6));
        uint256 industryLossLimit = vm.envOr("INDUSTRY_LOSS_LIMIT",         uint256(0));
        uint256 economicLossLimit = vm.envOr("ECONOMIC_LOSS_LIMIT",         uint256(0));
        uint256 subDuration       = vm.envOr("SUBSCRIPTION_SECONDS",        uint256(7 days));
        uint256 termDuration      = vm.envOr("TERM_SECONDS",                uint256(365 days));

        vm.startBroadcast();

        // 1. Deploy trigger (owned by companyWallet so they can manually flip it)
        ManualTrigger trigger = new ManualTrigger(companyWallet);

        // 2. Deploy bond
        CatBond bond = new CatBond(
            sponsor,
            companyWallet,
            address(trigger),
            usdcAddress,
            couponBps,
            coverage,
            minInvestment,
            industryLossLimit,
            economicLossLimit,
            subDuration,
            termDuration
        );

        vm.stopBroadcast();

        // Print addresses for the deployment log
        console2.log("ManualTrigger:", address(trigger));
        console2.log("CatBond:      ", address(bond));
        console2.log("requiredCouponBudget:", bond.requiredCouponBudget());
    }
}
