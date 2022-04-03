import hre from "hardhat";
import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { CollectorDAO, CollectorDAO__factory, NftMarketplace, NftMarketplace__factory } from "../typechain";

import collectorDaoABI from "../artifacts/contracts/CollectorDAO.sol/CollectorDAO.json";

describe("CollectorDAO Contract", () => {
  let collectorDao: CollectorDAO;
  let nftMarketplace: NftMarketplace;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let addr3: SignerWithAddress;
  let addrs: SignerWithAddress[];
  let mockNftAddress = "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d";

  beforeEach(async () => {
    [owner, addr1, addr2, addr3, ...addrs] = await ethers.getSigners();
    const daoContract = (await ethers.getContractFactory("CollectorDAO")) as CollectorDAO__factory;
    const nftMarketplaceContract = (await ethers.getContractFactory("NftMarketplace")) as NftMarketplace__factory;
    nftMarketplace = await nftMarketplaceContract.deploy();
    collectorDao = await daoContract.deploy();
    await collectorDao.deployed();
    await collectorDao.connect(owner).addContributions({ value: ethers.utils.parseEther("1") }); // set owner membership
  });

  function createMockProposal() {
    const collectorDaoInterface = new ethers.utils.Interface(collectorDaoABI.abi);
    return {
      targets: [collectorDao.address],
      values: [ethers.utils.parseEther("2")],
      calldatas: [
        collectorDaoInterface.encodeFunctionData("buyNftFromMarketplace", [nftMarketplace.address, mockNftAddress, 10]),
      ],
      description: "creating proposal to buy BAYC NFT with id 10",
    };
  }

  describe("Deployment", () => {
    it("should deploy contract with owner as member", async () => {
      expect(await collectorDao.isMember(owner.address)).to.equal(true);
    });
  });

  describe("Membership", () => {
    it("should give dao membership for users that contribute >= 1 eth", async () => {
      await collectorDao.connect(addr1).addContributions({ value: ethers.utils.parseEther("0.5") });
      expect(await collectorDao.isMember(addr1.address)).to.equal(false);
      await collectorDao.connect(addr1).addContributions({ value: ethers.utils.parseEther("0.5") });
      expect(await collectorDao.isMember(addr1.address)).to.equal(true);
    });
  });

  describe("Proposals", () => {
    it("should only allow members to create proposals", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      await expect(
        collectorDao.connect(addr1).createProposal(targets, values, calldatas, description)
      ).to.be.revertedWith("not a member");

      await collectorDao.connect(addr1).addContributions({ value: ethers.utils.parseEther("1") });
      await expect(collectorDao.connect(addr1).createProposal(targets, values, calldatas, description)).to.emit(
        collectorDao,
        "CreateProposal"
      );
    });

    it("new proposals are in pending state and switch to active state after 1 hour", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      expect(await collectorDao.getProposalState(1)).to.equal(0);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(1);
    });

    it("should only allow members to vote during active stage and only allows one vote", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      await expect(collectorDao.connect(addr1).castVote(addr1.address, 1, 1, "for vote")).to.be.revertedWith(
        "not a member"
      );
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await expect(collectorDao.connect(owner).castVote(owner.address, 1, 1, "for vote")).to.be.revertedWith(
        "proposal is not active"
      );
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.castVote(owner.address, 1, 1, "for vote")).to.emit(collectorDao, "CastVote");
      await expect(collectorDao.castVote(owner.address, 1, 0, "against vote"))
        .to.emit(collectorDao, "CastVote")
        .to.be.revertedWith("already voted");
    });

    it("should defeat proposal if there are more against votes", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      await collectorDao.connect(addr1).addContributions({ value: ethers.utils.parseEther("1") });
      await collectorDao.connect(addr2).addContributions({ value: ethers.utils.parseEther("1") });
      await collectorDao.connect(addr3).addContributions({ value: ethers.utils.parseEther("1") });
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVote(owner.address, 1, 0, "against vote");
      await collectorDao.connect(addr1).castVote(addr1.address, 1, 0, "against vote");
      await collectorDao.connect(addr2).castVote(addr2.address, 1, 0, "against vote");
      await collectorDao.connect(addr3).castVote(addr3.address, 1, 2, "abstain vote");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 3 + 3600]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(2);
    });

    it("should defeat proposal if quorum not reached", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      // add 15 members
      let members = 15;
      for (let i = 0; i < members; i++) {
        await collectorDao.connect(addrs[i]).addContributions({ value: ethers.utils.parseEther("1") });
      }
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVote(owner.address, 1, 1, "for vote");
      await collectorDao.connect(addrs[0]).castVote(addrs[0].address, 1, 1, "for vote");
      await collectorDao.connect(addrs[1]).castVote(addrs[1].address, 1, 1, "for vote");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 3 + 3600]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(2);
    });

    it("should succeed proposal if there are more for votes and quorum is reached", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      // add 15 members
      let members = 15;
      for (let i = 0; i < members; i++) {
        await collectorDao.connect(addrs[i]).addContributions({ value: ethers.utils.parseEther("1") });
      }
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVote(owner.address, 1, 1, "for vote");
      await collectorDao.connect(addrs[0]).castVote(addrs[0].address, 1, 1, "for vote");
      await collectorDao.connect(addrs[1]).castVote(addrs[1].address, 1, 1, "for vote");
      await collectorDao.connect(addrs[2]).castVote(addrs[2].address, 1, 0, "against vote");
      await collectorDao.connect(addrs[3]).castVote(addrs[3].address, 1, 0, "against vote");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 3 + 3600]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(3);
    });

    it("should not allow vote buying by new members on proposal created before having membership", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      collectorDao.connect(addr1).addContributions({ value: ethers.utils.parseEther("1") });
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVote(owner.address, 1, 1, "for vote");
      await collectorDao.connect(addr1).castVote(addr1.address, 1, 0, "against vote");
      // a new user tries to influence "vote" by getting membership
      collectorDao.connect(addr2).addContributions({ value: ethers.utils.parseEther("1") });
      await expect(collectorDao.connect(addr2).castVote(addr2.address, 1, 1, "for vote")).to.be.revertedWith(
        "not member when proposal created"
      );
    });

    it("should allow successful proposals to be queued", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      let members = 10;
      for (let i = 0; i < members; i++) {
        await collectorDao.connect(addrs[i]).addContributions({ value: ethers.utils.parseEther("1") });
      }
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await expect(collectorDao.queueProposal(1)).to.be.revertedWith("proposal did not succeed");
      await collectorDao.castVote(owner.address, 1, 1, "for vote");
      await collectorDao.connect(addrs[0]).castVote(addrs[0].address, 1, 1, "for vote");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 3 + 3600]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(3);
      expect(await collectorDao.queueProposal(1)).to.emit(collectorDao, "ProposalQueued");
    });

    it("should allow queued proposals to be executed after the timelock period has passed", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      let members = 10;
      for (let i = 0; i < members; i++) {
        await collectorDao.connect(addrs[i]).addContributions({ value: ethers.utils.parseEther("1") });
      }
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVote(owner.address, 1, 1, "for vote");
      await collectorDao.connect(addrs[0]).castVote(addrs[0].address, 1, 1, "for vote");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 3 + 3600]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(3);
      expect(await collectorDao.queueProposal(1)).to.emit(collectorDao, "ProposalQueued");
      await expect(collectorDao.executeProposal(1)).to.be.revertedWith("tx hasn't surpassed timelock");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 2 + 3600]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.executeProposal(1)).to.emit(collectorDao, "ExecuteTransaction");
      expect(await collectorDao.getProposalState(1)).to.equal(6);
    });

    it("should expire queued proposals after 5 days if not executed", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      let members = 10;
      for (let i = 0; i < members; i++) {
        await collectorDao.connect(addrs[i]).addContributions({ value: ethers.utils.parseEther("1") });
      }
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVote(owner.address, 1, 1, "for vote");
      await collectorDao.connect(addrs[0]).castVote(addrs[0].address, 1, 1, "for vote");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 3]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(3);
      expect(await collectorDao.queueProposal(1)).to.emit(collectorDao, "ProposalQueued");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 10]);
      await hre.network.provider.send("evm_mine");
      await expect(collectorDao.executeProposal(1)).to.be.revertedWith("only executable if queued");
      expect(await collectorDao.getProposalState(1)).to.equal(5);
    });

    it("should revert executed proposal if insufficient funds from treasury", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVote(owner.address, 1, 1, "for vote");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 3 + 3600]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(3);
      expect(await collectorDao.queueProposal(1)).to.emit(collectorDao, "ProposalQueued");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 2 + 3600]);
      await hre.network.provider.send("evm_mine");
      await expect(collectorDao.executeProposal(1)).to.be.revertedWith("Collector: call reverted without message");
    });

    it("should successfully execute proposal if sufficient funds from treasury", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      await collectorDao.connect(addr1).addContributions({ value: ethers.utils.parseEther("10") });
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVote(owner.address, 1, 1, "for vote");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 3 + 3600]);
      await hre.network.provider.send("evm_mine");
      expect(await collectorDao.getProposalState(1)).to.equal(3);
      expect(await collectorDao.queueProposal(1)).to.emit(collectorDao, "ProposalQueued");
      await hre.network.provider.send("evm_increaseTime", [3600 * 24 * 2 + 3600]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.executeProposal(1);
      expect(await collectorDao.getProposalState(1)).to.equal(6);
    });
  });

  describe("Cast Vote by Sig", () => {
    it("should allow members to cast vote by signature", async () => {
      const { targets, values, calldatas, description } = createMockProposal();
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");

      const domain = {
        name: "CollectorDao",
        chainId: 1337, // hardhat
        verifyingContract: collectorDao.address,
      };
      const ballotTypes = {
        Ballot: [
          { name: "proposalId", type: "uint256" },
          { name: "support", type: "uint8" },
        ],
      };

      const signature = await owner._signTypedData(domain, ballotTypes, { proposalId: 1, support: 1 });
      const splitSig = ethers.utils.splitSignature(signature);
      await collectorDao.connect(owner).castVoteBySig(1, 1, splitSig.v, splitSig.r, splitSig.s);

      const [memberHasVoted, voteType] = await collectorDao.connect(owner).getMemberVoteOnProposal(1);
      expect(memberHasVoted).to.equal(true);
      expect(voteType).to.equal(1);
    });

    it("should allow batch vote by signature function call", async () => {
      await collectorDao.connect(addr1).addContributions({ value: ethers.utils.parseEther("1") });

      const { targets, values, calldatas, description } = createMockProposal();
      await collectorDao.connect(owner).createProposal(targets, values, calldatas, description);

      const domain = {
        name: "CollectorDao",
        chainId: 1337, // hardhat
        verifyingContract: collectorDao.address,
      };
      const ballotTypes = {
        Ballot: [
          { name: "proposalId", type: "uint256" },
          { name: "support", type: "uint8" },
        ],
      };
      const members = [owner, addr1];
      const proposalsId = [1, 1];
      const voteType = [];
      const v = [];
      const r = [];
      const s = [];

      for (let i = 0; i < 2; i++) {
        voteType.push(i);
        const signature = await members[i]._signTypedData(domain, ballotTypes, { proposalId: 1, support: i });
        const splitSig = ethers.utils.splitSignature(signature);
        v.push(splitSig.v);
        r.push(splitSig.r);
        s.push(splitSig.s);
      }
      await hre.network.provider.send("evm_increaseTime", [3600 * 2]);
      await hre.network.provider.send("evm_mine");
      await collectorDao.castVoteBySigBatch(proposalsId, voteType, v, r, s);

      const [member1HasVoted, member1VoteType] = await collectorDao.connect(owner).getMemberVoteOnProposal(1);
      const [member2HasVoted, member2VoteType] = await collectorDao.connect(addr1).getMemberVoteOnProposal(1);
      expect(member1HasVoted).to.equal(true);
      expect(member1VoteType).to.equal(0);
      expect(member2HasVoted).to.equal(true);
      expect(member2VoteType).to.equal(1);
    });
  });
});
