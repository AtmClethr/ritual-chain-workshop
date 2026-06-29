# Test Plan

## Automated Solidity Tests

Run from `hardhat`:

```bash
pnpm install
npx hardhat test solidity
```

Covered cases in `contracts/CommitRevealBounty.t.sol`:

- Full lifecycle: create bounty, submit two commitments, reveal both, record a batch AI review, finalize winner, and pay reward.
- Hidden answers: `getEntry` returns an empty answer before reveal.
- Commit cutoff: commitments revert after `commitDeadline`.
- Commitment update: participant can update their commitment before reveal starts.
- Early reveal: reveal reverts before `commitDeadline`.
- Late reveal: reveal reverts after `revealDeadline`.
- Wrong salt: reveal reverts with `commitment mismatch`.
- Wrong answer: reveal reverts with `commitment mismatch`.
- Wrong sender: reveal fails because `msg.sender` is bound into the hash.
- No commitment: reveal reverts when the participant never committed.
- Double reveal: second reveal reverts.
- Judge too early: `judgeAll` reverts before `revealDeadline`.
- Judge not owner: non-owner cannot call `judgeAll`.
- Judge no reveals: `judgeAll` reverts when nobody revealed.
- Finalize too early: `finalizeWinner` reverts before `judgeAll`.
- Unrevealed winner: owner cannot finalize an unrevealed entry.
- No-reveal refund: owner can reclaim the reward if nobody reveals.

## Manual Frontend Test

1. Deploy `CommitRevealBounty` to Ritual testnet.
2. Set `NEXT_PUBLIC_CONTRACT_ADDRESS` in `web/.env.local`.
3. Start the frontend with `pnpm dev`.
4. Connect the creator wallet and create a bounty with short commit/reveal deadlines.
5. Connect user1 and user2 wallets and submit commitments with different answers.
6. Confirm the entries list shows commitments while answers stay hidden.
7. After the commit deadline, reveal each answer with the exact matching salt.
8. Confirm wrong salt or changed answer reverts.
9. After the reveal deadline, fund the creator Ritual Wallet and call `judgeAll` once.
10. Confirm the AI review appears and the owner can finalize only a revealed entry.

## Three-Wallet Script Test

Use `hardhat/scripts/threeWalletFlow.ts` for a basic on-chain smoke test using creator, user1, and user2 keys. The script does not hide secrets from the local machine; it is only for testnet demonstration.