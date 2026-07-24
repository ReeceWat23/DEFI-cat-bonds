// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Test-only. Do NOT deploy to mainnet.

import "../contracts/CatBond.sol";

/// @title CatBondHarness
/// @notice Thin test subclass of CatBond that replaces block.timestamp with a
///         settable mock clock. Lets Remix's JavaScript VM run time-dependent
///         tests without vm.warp, archive nodes, or mainnet forks.
contract CatBondHarness is CatBond {
    uint256 public mockTime;

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
    )
        CatBond(
            _sponsor,
            _companyWallet,
            _trigger,
            _usdc,
            _couponRateBps,
            _coverageAmount,
            _minInvestment,
            _subscriptionDuration,
            _termDuration
        )
    {
        mockTime = block.timestamp;
    }

    /// @notice Set the mock clock to an absolute timestamp.
    function setTime(uint256 t) external {
        mockTime = t;
    }

    /// @notice Advance the mock clock by `secs` seconds.
    function advanceTime(uint256 secs) external {
        mockTime += secs;
    }

    /// @dev Overrides CatBond._now() to return the mock clock instead of block.timestamp.
    function _now() internal view override returns (uint256) {
        return mockTime;
    }
}
