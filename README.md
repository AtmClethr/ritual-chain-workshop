# Privacy-Preserving AI Bounty Judge

This repository implements the Ritual Bootcamp 1 assignment: a bounty judge where participants cannot copy public answers during the submission phase. The main implementation is the required EVM-compatible commit-reveal track.

## What The Assignment Asked For

Participants must submit only a commitment hash before the commit deadline. After that deadline, they reveal the plaintext answer and salt. The contract verifies:

```solidity
keccak256(abi.encode(answer, salt, msg.sender, bountyId)) == commitment
```

Only entries with a valid reveal are eligible for AI judging. The bounty owner then calls one batch `judgeAll` transaction, reviews the AI output, and manually finalizes the winner with `finalizeWinner`.

## Key Files

- `hardhat/contracts/CommitRevealBounty.sol` — required Solidity commit-reveal contract.
- `hardhat/contracts/CommitRevealBounty.t.sol` — reveal-case and lifecycle tests.
- `hardhat/ignition/modules/AIJudge.ts` — deploys `CommitRevealBounty`.
- `hardhat/scripts/threeWalletFlow.ts` — optional Ritual testnet helper using creator, user1, and user2 wallets.
- `web/src/abi/AIJudge.ts` — frontend ABI for the new contract.
- `web/src/components/SubmitAnswer.tsx` — commit/reveal frontend UI.
- `ARCHITECTURE.md` — on-chain/off-chain privacy architecture note.
- `TEST_PLAN.md` — manual and automated reveal-case test plan.

## Lifecycle

1. **Create bounty** — owner calls `createBounty(title, rubric, commitDeadline, revealDeadline)` and locks the reward with `msg.value`.
2. **Commit phase** — participants call `submitCommitment(bountyId, commitment)` where `commitment` is a hash of answer, salt, participant address, and bounty id.
3. **Reveal phase** — after `commitDeadline`, participants call `revealAnswer(bountyId, answer, salt)`.
4. **Validation** — the contract recomputes the hash with `msg.sender` and rejects wrong answer, wrong salt, wrong sender, duplicate reveal, and late reveal.
5. **AI judging** — after `revealDeadline`, the owner calls `judgeAll(bountyId, llmInput)` once; the prompt should include only valid revealed answers.
6. **Human finalization** — owner calls `finalizeWinner(bountyId, winnerIndex)`; the winner must be a revealed entry.

## Required Functions

Implemented in `CommitRevealBounty.sol`:

```solidity
submitCommitment(uint256 bountyId, bytes32 commitment)
revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt)
judgeAll(uint256 bountyId, bytes calldata llmInput)
finalizeWinner(uint256 bountyId, uint256 winnerIndex)
```

The contract also includes helpers: `createBounty`, `getBounty`, `getEntry`, `getEntryIndex`, `entryCount`, `computeCommitment`, and `refundIfNoReveals`.

## Setup

Install dependencies in each app folder:

```bash
cd hardhat
pnpm install
npx hardhat compile
npx hardhat test solidity
```

For the frontend:

```bash
cd web
pnpm install
pnpm dev
```

## Ritual Testnet Deployment

Set your creator key as the deployer key. Do not commit real private keys.

```bash
cd hardhat
$env:DEPLOYER_PRIVATE_KEY="0xYOUR_CREATOR_PRIVATE_KEY"
npx hardhat ignition deploy ignition/modules/AIJudge.ts --network ritual
```

After deployment, set the frontend address:

```bash
cd ../web
$env:NEXT_PUBLIC_CONTRACT_ADDRESS="0xDEPLOYED_CONTRACT"
pnpm dev
```

## Three-Wallet Demo Script

The helper script uses three wallets: creator, user1, and user2. It creates a bounty, submits commitments for both users, waits for the commit window, then reveals both answers.

```bash
cd hardhat
$env:CONTRACT_ADDRESS="0xDEPLOYED_CONTRACT"
$env:CREATOR_PRIVATE_KEY="0xCREATOR_KEY"
$env:USER1_PRIVATE_KEY="0xUSER1_KEY"
$env:USER2_PRIVATE_KEY="0xUSER2_KEY"
npx hardhat run scripts/threeWalletFlow.ts --network ritual
```

For the required track, `judgeAll` records the batch review bytes and does not require a Ritual precompile. The advanced Ritual-native design is documented separately in `ARCHITECTURE.md`.

## Reflection

What should be public in a bounty system is the bounty metadata, reward amount, deadlines, rules, commitments, reveal status, AI review, final winner, and payout transaction. What should stay hidden during the submission phase is the actual answer text and any salt or private reasoning that would let another participant copy the work. After the reveal deadline, valid revealed answers can become public so the judging process is auditable and participants can verify that the winner was selected from legitimate entries. AI should help with scalable comparison, rubric scoring, summarization, and identifying a recommended winner across many submissions. A human should decide the final winner because AI can misunderstand context, hallucinate, or overweight style instead of correctness. Humans should also handle disputes, edge cases, plagiarism accusations, and bounty-rule interpretation that requires accountability beyond a model output.