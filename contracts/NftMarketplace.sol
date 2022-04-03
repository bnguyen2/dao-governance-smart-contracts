//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;
import "hardhat/console.sol";

// mock market place for testing
contract NftMarketplace {
    function getPrice(address nftContract, uint256 nftId) external view returns (uint256 price) {
        console.log("nft contract", nftContract, nftId); // logging for testing
        return 2 ether;
    }

    function buy(address nftContract, uint256 nftId) external payable returns (bool success) {
        console.log("nft contract buy", nftContract, nftId); // logging for testing
        return true;
    }
}
