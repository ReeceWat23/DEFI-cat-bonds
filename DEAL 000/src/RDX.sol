// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title RDX — RedX Dollar (test stablecoin)
/// @notice 1 RDX = $1 USD. 6 decimals to match USDC.
///         Ownable mint() so the deployer can pre-fund test wallets.
contract RDX is ERC20, Ownable {
    constructor(address initialOwner)
        ERC20("RedX Dollar", "RDX")
        Ownable(initialOwner)
    {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
