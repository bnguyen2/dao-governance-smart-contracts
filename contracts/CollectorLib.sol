//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

library CollectorLib {
    string public constant NAME = "CollectorDao";

    uint256 public constant MEMBERSHIP_COST = 1 ether;
    uint256 public constant QUORUM = 25; // 25% of the total members
    uint256 public constant VOTING_DELAY = 1 hours;
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant TIMELOCK_DELAY = 2 days;
    uint256 public constant GRACE_PERIOD = 5 days;

    /// @notice The EIP-712 typehash for the contract's domain
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");

    /// @notice The EIP-712 typehash for the ballot struct used by the contract
    bytes32 public constant BALLOT_TYPEHASH = keccak256("Ballot(uint256 proposalId,uint8 support)");

    // taken from OZ Address
    function verifyCallResult(
        bool success,
        bytes memory returndata,
        string memory errorMessage
    ) internal pure returns (bytes memory) {
        if (success) {
            return returndata;
        } else {
            // Look for revert reason and bubble it up if present
            if (returndata.length > 0) {
                // The easiest way to bubble the revert reason is using memory via assembly
                assembly {
                    let returndata_size := mload(returndata)
                    revert(add(32, returndata), returndata_size)
                }
            } else {
                revert(errorMessage);
            }
        }
    }
}
