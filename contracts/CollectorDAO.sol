//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./CollectorLib.sol";

interface INftMarketplace {
    function getPrice(address nftContract, uint256 nftId) external pure returns (uint256 price);

    function buy(address nftContract, uint256 nftId) external payable returns (bool success);
}

contract CollectorDAO {
    uint256 public proposalCount;
    uint256 public membersCount;

    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public latestProposalIds;
    mapping(address => uint256) public memberContributions;
    mapping(address => uint256) public memberJoinBlock;
    mapping(address => bool) public isMember;
    mapping(bytes32 => bool) public queuedTransactions;

    struct Proposal {
        uint256 id;
        address proposer;
        uint256 eta;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
        mapping(address => Receipt) receipts;
    }

    enum ProposalState {
        pending,
        active,
        defeated,
        succeeded,
        queued,
        expired,
        executed
    }

    struct Receipt {
        bool hasVoted;
        uint8 voteType;
    }

    event ContributionsAdded(address indexed contributor, uint256 amount);
    event CastVote(address indexed voter, uint256 proposalId, uint8 voteType, string reason);
    event CreateProposal(
        uint256 proposalId,
        address indexed proposer,
        uint256 startBlock,
        uint256 endBlock,
        string description
    );
    event QueueTransaction(bytes32 indexed txHash, address indexed target, uint256 value, bytes data, uint256 eta);
    event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint256 value, bytes data, uint256 eta);
    event ProposalQueued(uint256 proposalId, uint256 eta);
    event ProposalExecuted(uint256 proposalId);

    modifier onlyMember() {
        require(isMember[msg.sender], "not a member");
        _;
    }

    function addContributions() external payable {
        require(msg.value > 0, "nothing contributed");
        require(!isMember[msg.sender], "already a member");
        memberContributions[msg.sender] += msg.value;
        if (!isMember[msg.sender] && memberContributions[msg.sender] >= CollectorLib.MEMBERSHIP_COST) {
            isMember[msg.sender] = true;
            memberJoinBlock[msg.sender] = block.timestamp;
            membersCount++;
        }
        emit ContributionsAdded(msg.sender, msg.value);
    }

    function getProposalState(uint256 _proposalId) public view returns (ProposalState) {
        require(proposalCount >= _proposalId && _proposalId != 0, "invalid proposal id");
        Proposal storage proposal = proposals[_proposalId];
        if (block.timestamp <= proposal.startBlock) {
            return ProposalState.pending;
        } else if (block.timestamp <= proposal.endBlock) {
            return ProposalState.active;
        } else if (
            proposal.forVotes <= proposal.againstVotes ||
            (proposal.forVotes + proposal.againstVotes + proposal.abstainVotes) <
            ((CollectorLib.QUORUM * membersCount) / 100)
        ) {
            return ProposalState.defeated;
        } else if (proposal.eta == 0) {
            return ProposalState.succeeded;
        } else if (proposal.executed) {
            return ProposalState.executed;
        } else if (block.timestamp >= (proposal.eta + CollectorLib.GRACE_PERIOD)) {
            return ProposalState.expired;
        } else {
            return ProposalState.queued;
        }
    }

    function createProposal(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        string memory _description
    ) external onlyMember returns (uint256 proposalId) {
        require(
            _targets.length != 0 && _targets.length == _values.length && _targets.length == _calldatas.length,
            "invalid proposal parameters"
        );

        uint256 latestProposalId = latestProposalIds[msg.sender];
        if (latestProposalId != 0) {
            ProposalState memberLatestProposalState = getProposalState(latestProposalId);
            require(memberLatestProposalState != ProposalState.active, "one live proposal per member");
            require(memberLatestProposalState != ProposalState.pending, "one live proposal per member");
        }

        uint256 startBlock = block.timestamp + CollectorLib.VOTING_DELAY;
        uint256 endBlock = startBlock + CollectorLib.VOTING_PERIOD;

        Proposal storage newProposal = proposals[++proposalCount];
        newProposal.id = proposalCount;
        newProposal.proposer = msg.sender;
        newProposal.eta = 0;
        newProposal.targets = _targets;
        newProposal.values = _values;
        newProposal.calldatas = _calldatas;
        newProposal.startBlock = startBlock;
        newProposal.endBlock = endBlock;
        newProposal.forVotes = 0;
        newProposal.againstVotes = 0;
        newProposal.abstainVotes = 0;
        newProposal.executed = false;

        latestProposalIds[msg.sender] = proposalCount;

        emit CreateProposal(newProposal.id, newProposal.proposer, startBlock, endBlock, _description);
        return newProposal.id;
    }

    /**
     * _voteType options: 0 = against, 1 = for, 2 = abstain
     * @notice only allows members who has membership before proposal was created to vote
     * this is to protect against vote buying
     */
    function castVote(
        address _voter,
        uint256 _proposalId,
        uint8 _voteType,
        string memory _reason
    ) public onlyMember {
        require(getProposalState(_proposalId) == ProposalState.active, "proposal is not active");
        require(_voteType <= 2, "invalid vote");
        Proposal storage proposal = proposals[_proposalId];
        Receipt storage receipt = proposal.receipts[_voter];
        require(receipt.hasVoted == false, "already voted");
        uint256 snapshot = proposal.startBlock - CollectorLib.VOTING_DELAY; // subtract delay to get time proposal was created
        require(memberJoinBlock[_voter] <= snapshot, "not member when proposal created");

        if (_voteType == 0) {
            proposal.againstVotes++;
        } else if (_voteType == 1) {
            proposal.forVotes++;
        } else if (_voteType == 2) {
            proposal.abstainVotes++;
        }

        receipt.hasVoted = true;
        receipt.voteType = _voteType;

        emit CastVote(_voter, _proposalId, _voteType, _reason);
    }

    function castVoteBySig(
        uint256 _proposalId,
        uint8 _voteType,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external onlyMember {
        _castVoteBySig(_proposalId, _voteType, _v, _r, _s);
    }

    /**
     * @notice Cast a vote for a proposal by signature by batch
     */
    function castVoteBySigBatch(
        uint256[] calldata _proposalId,
        uint8[] calldata _voteType,
        uint8[] calldata _v,
        bytes32[] calldata _r,
        bytes32[] calldata _s
    ) external onlyMember {
        require(
            _proposalId.length == _voteType.length &&
                _proposalId.length == _v.length &&
                _proposalId.length == _r.length &&
                _proposalId.length == _s.length,
            "invalid vote parameters"
        );

        for (uint256 i = 0; i < _proposalId.length; i++) {
            _castVoteBySig(_proposalId[i], _voteType[i], _v[i], _r[i], _s[i]);
        }
    }

    /**
     * @notice Cast a vote for a proposal by signature
     */
    function _castVoteBySig(
        uint256 _proposalId,
        uint8 _voteType,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                CollectorLib.DOMAIN_TYPEHASH,
                keccak256(bytes(CollectorLib.NAME)),
                _getChainIdInternal(),
                address(this)
            )
        );
        bytes32 structHash = keccak256(abi.encode(CollectorLib.BALLOT_TYPEHASH, _proposalId, _voteType));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signatory = ecrecover(digest, _v, _r, _s);
        require(signatory != address(0), "invalid signature");
        castVote(signatory, _proposalId, _voteType, "");
    }

    function queueProposal(uint256 _proposalId) external onlyMember {
        require(getProposalState(_proposalId) == ProposalState.succeeded, "proposal did not succeed");
        Proposal storage proposal = proposals[_proposalId];
        uint256 eta = block.timestamp + CollectorLib.TIMELOCK_DELAY;
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            _queueTransaction(proposal.targets[i], proposal.values[i], proposal.calldatas[i], eta);
        }
        proposal.eta = eta;
        emit ProposalQueued(_proposalId, eta);
    }

    /**
     * @dev allows members execute a proposal in queue
     * @param _proposalId The id of the proposal to vote on
     * @notice proposal will only be successfully executed if it is in queue and
     * there is enough funds to purchase the NFT
     */
    function executeProposal(uint256 _proposalId) external onlyMember {
        require(getProposalState(_proposalId) == ProposalState.queued, "only executable if queued");
        Proposal storage proposal = proposals[_proposalId];
        proposal.executed = true;
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            _executeTransaction(proposal.targets[i], proposal.values[i], proposal.calldatas[i], proposal.eta);
        }
        emit ProposalExecuted(_proposalId);
    }

    /**
     * @dev used for proposal to be executed only by dao contract
     */
    function buyNftFromMarketplace(
        INftMarketplace _marketplace,
        address _nftContract,
        uint256 _nftId
    ) external payable {
        require(msg.sender == address(this), "not dao contract");
        uint256 price = _marketplace.getPrice(_nftContract, _nftId);
        require(price <= address(this).balance, "insufficient funds to purchase");
        bool success = _marketplace.buy{value: price}(_nftContract, _nftId);
        require(success, "marketplace failed to buy");
    }

    function getMemberVoteOnProposal(uint256 _proposalId) external view returns (Receipt memory) {
        return proposals[_proposalId].receipts[msg.sender];
    }

    function _queueTransaction(
        address _target,
        uint256 _value,
        bytes memory _data,
        uint256 _eta
    ) internal {
        bytes32 txHash = keccak256(abi.encode(_target, _value, _data, _eta));
        require(!queuedTransactions[txHash], "identical tx queued");
        require(_eta >= block.timestamp + CollectorLib.TIMELOCK_DELAY, "exec. block must satify delay");
        queuedTransactions[txHash] = true;
        emit QueueTransaction(txHash, _target, _value, _data, _eta);
    }

    function _executeTransaction(
        address _target,
        uint256 _value,
        bytes memory _data,
        uint256 _eta
    ) internal {
        bytes32 txHash = keccak256(abi.encode(_target, _value, _data, _eta));
        require(queuedTransactions[txHash], "tx hasn't been queued");
        require(block.timestamp >= _eta, "tx hasn't surpassed timelock");
        require(block.timestamp <= (_eta + CollectorLib.GRACE_PERIOD), "tx has expired");
        queuedTransactions[txHash] = false;
        string memory errorMessage = "Collector: call reverted without message";
        (bool success, bytes memory returndata) = _target.call{value: _value}(_data);
        CollectorLib.verifyCallResult(success, returndata, errorMessage);
        emit ExecuteTransaction(txHash, _target, _value, _data, _eta);
    }

    function _getChainIdInternal() internal view returns (uint256) {
        uint256 chainId;
        // solhint-disable-next-line
        assembly {
            chainId := chainid()
        }
        return chainId;
    }
}
