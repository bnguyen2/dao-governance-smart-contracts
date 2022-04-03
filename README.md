## Notes

The CollectorDAO smart contract governance features are heavily influenced by Compounds Finance Governor Bravo contract. The smart contract allows any members to create a proposal, vote on the proposal, and execute the proposal if successful to make a purchase of a NFT from an NFT marketplace.

- [x] Allows anyone to buy a membership for 1 ETH
- [x] Allows a member to propose an NFT to buy
- [x] Allows members to vote on proposals:
  - [x] With a 25% quorum
- [x] If passed, have the contract purchase the NFT in a reasonably automated fashion.

In the voting feature, I've included a requirement "snapshot" of the current proposal vs when the user had become a member. User's are only allow to vote on the proposal if they were a member before the proposal was created. This is to prevent users from buying "votes" to influence the decision of the proposal. Also made a decision to not allow members or owner to cancel a created proposal as we want to make the system more decentralized and not allow malicious users to cancel a successful proposal. User's can vote on a proposal, in addition to voting by signature based on EIP712, and voting batch voting.

## Smart Contract Testing

```
npx hardhat test
npx hardhat coverage
REPORT_GAS=true npx hardhat test
```

# Design Exercises

- Per project specs, there is no vote delegation. This means for someone's vote to count, they must manually participate every time. How would you design your contract to allow for non-transitive vote delegation?
- What are some problems with implementing transitive vote delegation on-chain? (Transitive means: If A delegates to B, and B delegates to C, then C gains voting power from both A and B, while B has no voting power).

# Answers

- One way to do this is by having a whitelist of delegates. Members who are delegates can receive additional voting power passed on by regular members, and can vote on proposals but cannot delegate their voting powers to other members. This way we won't run into the transitive voting issue. In the smart contract we can have a "delegate" or "delegate by sig" and users can only delegate to members who are choosen/whitelisted as the delegatees. Delegate should be blocked on calling the "delegate" function.

- Removal of responsibilities while giving higher voting power to another
- Bad actors
- For example, A is a whale, he delegates his voting powers to B who is his other whale friend. B now has the voting power of A and B, then A can dump his tokens, while B has gained more voting power
- Let's say A delegates his votes to B who he really trusts to make the right decisions. However a situation came up where B can no longer give his time to support the project so he delegates his votes to C who is an evil friend. A doesn't trust C, but because he delegated his vote, he stuck with the decisions that C makes
