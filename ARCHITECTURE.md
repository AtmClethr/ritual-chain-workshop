# Architecture Note

## Required Track: Commit-Reveal Bounty

The required implementation uses a standard EVM commit-reveal protocol. During the commit phase, the chain stores only `bytes32 commitment` values and participant addresses. A commitment is calculated as:

```solidity
keccak256(abi.encode(answer, salt, msg.sender, bountyId))
```

Including `msg.sender` prevents another wallet from copying a valid answer and salt during reveal. Including `bountyId` prevents replaying the same commitment across bounties.

## Where Plaintext Exists

Before reveal, plaintext exists only wherever the participant keeps it: their browser form/local storage, notes app, script environment, or wallet automation. It is not stored on-chain during the commit phase. After a valid reveal, plaintext is stored on-chain in the revealed entry so the AI prompt and final decision can be audited.

## What Is Stored On-Chain

On-chain storage includes bounty owner, title, rubric, reward, commit deadline, reveal deadline, judging/finalization flags, AI review bytes, winner index, participant addresses, commitment hashes, reveal status, and revealed answer text. Unrevealed answers are never written to contract storage. A non-revealed entry can never win because `finalizeWinner` requires `entry.revealed == true`.

## What Is Stored Off-Chain

Before reveal, answers and salts are off-chain participant secrets. The web app may save a participant's answer and salt in browser local storage only to help them reveal later; this is user-local storage, not public storage. A production app should warn users to back up their answer and salt because losing either makes reveal impossible.

## How The LLM Receives Submissions

After `revealDeadline`, the bounty owner or frontend reads all entries with `getEntry`. It filters to `revealed == true` entries, builds one batch review from the bounty title, rubric, and revealed answers, and passes that review as `llmInput`. The required-track contract records that batch review on-chain and does not depend on a chain-specific precompile, so it works on any EVM chain. A Ritual-native implementation can move review generation into a TEE as described below.

## Ritual-Native Hidden Submissions Design

For the advanced track, answers could be encrypted off-chain to a Ritual TEE executor public key during the submission phase. The chain would store participant address, commitment/hash, encrypted blob pointer or ciphertext hash, and lifecycle state, while the encrypted answer payloads would live off-chain in storage such as IPFS, a server, or a data availability layer. During judging, the bounty owner would send one encrypted batch request to Ritual; plaintext answers would exist only inside the TEE while decrypting, assembling the batch prompt, and calling the LLM. The chain would receive only the final AI review, winner recommendation, and optionally hashes/attestations proving which encrypted submissions were included. This keeps plaintext hidden even through the reveal/judging moment, but requires stronger operational handling of TEE keys, encrypted input formats, attestations, and recovery paths.

## Human-In-The-Loop Finalization

`judgeAll` stores an AI review but does not transfer the reward. The owner must call `finalizeWinner`, and the contract checks the selected winner index is a valid revealed entry. This keeps AI useful for ranking and explanation while preserving human accountability for the final payout.