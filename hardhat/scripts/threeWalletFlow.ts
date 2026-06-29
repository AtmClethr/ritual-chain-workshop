import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  parseEther,
  parseEventLogs,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ritual = defineChain({
  id: 1979,
  name: "Ritual Testnet",
  nativeCurrency: { name: "Ritual", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org"] },
  },
});

const abi = parseAbi([
  "event BountyCreated(uint256 indexed bountyId,address indexed owner,string title,uint256 reward,uint256 commitDeadline,uint256 revealDeadline)",
  "function createBounty(string title,string rubric,uint256 commitDeadline,uint256 revealDeadline) payable returns (uint256 bountyId)",
  "function submitCommitment(uint256 bountyId,bytes32 commitment)",
  "function revealAnswer(uint256 bountyId,string answer,bytes32 salt)",
  "function judgeAll(uint256 bountyId,bytes llmInput)",
  "function finalizeWinner(uint256 bountyId,uint256 winnerIndex)",
]);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function privateKey(name: string): Hex {
  const raw = required(name).trim();
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function randomSalt(label: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }], [`${label}:${Date.now()}`]));
}

function commitment(bountyId: bigint, answer: string, salt: Hex, participant: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [answer, salt, participant, bountyId],
    ),
  );
}

function wallet(account: PrivateKeyAccount) {
  return createWalletClient({ account, chain: ritual, transport: http() });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const contractAddress = required("CONTRACT_ADDRESS") as Hex;
  const creator = privateKeyToAccount(privateKey("CREATOR_PRIVATE_KEY"));
  const user1 = privateKeyToAccount(privateKey("USER1_PRIVATE_KEY"));
  const user2 = privateKeyToAccount(privateKey("USER2_PRIVATE_KEY"));

  const publicClient = createPublicClient({ chain: ritual, transport: http() });
  const creatorWallet = wallet(creator);
  const user1Wallet = wallet(user1);
  const user2Wallet = wallet(user2);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const commitSeconds = BigInt(process.env.COMMIT_SECONDS ?? "120");
  const revealSeconds = BigInt(process.env.REVEAL_SECONDS ?? "120");
  const commitDeadline = now + commitSeconds;
  const revealDeadline = commitDeadline + revealSeconds;
  const reward = parseEther(process.env.BOUNTY_REWARD ?? "0.001");

  console.log("Creator", creator.address);
  console.log("User1  ", user1.address);
  console.log("User2  ", user2.address);

  console.log("Creating bounty...");
  const createHash = await creatorWallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "createBounty",
    args: [
      process.env.BOUNTY_TITLE ?? "Commit-reveal bounty demo",
      process.env.BOUNTY_RUBRIC ?? "Pick the clearest, most complete answer.",
      commitDeadline,
      revealDeadline,
    ],
    value: reward,
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  const createdLogs = parseEventLogs({ abi, eventName: "BountyCreated", logs: createReceipt.logs });
  const bountyId = createdLogs[0].args.bountyId;
  console.log("Bounty id", bountyId.toString());

  const answer1 = process.env.USER1_ANSWER ?? "User 1 answer: concise and practical.";
  const answer2 = process.env.USER2_ANSWER ?? "User 2 answer: detailed and creative.";
  const salt1 = (process.env.USER1_SALT as Hex | undefined) ?? randomSalt("user1");
  const salt2 = (process.env.USER2_SALT as Hex | undefined) ?? randomSalt("user2");
  const commitment1 = commitment(bountyId, answer1, salt1, user1.address);
  const commitment2 = commitment(bountyId, answer2, salt2, user2.address);

  console.log("Submitting commitments...");
  const commitHash1 = await user1Wallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "submitCommitment",
    args: [bountyId, commitment1],
  });
  await publicClient.waitForTransactionReceipt({ hash: commitHash1 });

  const commitHash2 = await user2Wallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "submitCommitment",
    args: [bountyId, commitment2],
  });
  await publicClient.waitForTransactionReceipt({ hash: commitHash2 });

  console.log("Commitments submitted.");
  console.log("User1 salt", salt1);
  console.log("User2 salt", salt2);

  const waitMs = Math.max(Number(commitDeadline - BigInt(Math.floor(Date.now() / 1000)) + 2n), 0) * 1000;
  if (waitMs > 0) {
    console.log(`Waiting ${Math.ceil(waitMs / 1000)} seconds for reveal phase...`);
    await sleep(waitMs);
  }

  console.log("Revealing answers...");
  const revealHash1 = await user1Wallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "revealAnswer",
    args: [bountyId, answer1, salt1],
  });
  await publicClient.waitForTransactionReceipt({ hash: revealHash1 });

  const revealHash2 = await user2Wallet.writeContract({
    address: contractAddress,
    abi,
    functionName: "revealAnswer",
    args: [bountyId, answer2, salt2],
  });
  await publicClient.waitForTransactionReceipt({ hash: revealHash2 });

  console.log("Reveals submitted.");
  console.log("Next: fund the creator RitualWallet, wait for revealDeadline, then judgeAll via the web app.");
  console.log("Bounty id", bountyId.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});