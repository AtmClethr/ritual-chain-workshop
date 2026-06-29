import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatEther,
  http,
  keccak256,
  parseAbi,
  parseEther,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";

const ritual = defineChain({
  id: 1979,
  name: "Ritual Testnet",
  nativeCurrency: { name: "Ritual", symbol: "RIT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.ritualfoundation.org"] } },
});

const abi = parseAbi([
  "event BountyCreated(uint256 indexed bountyId,address indexed owner,string title,uint256 reward,uint256 commitDeadline,uint256 revealDeadline)",
  "function createBounty(string title,string rubric,uint256 commitDeadline,uint256 revealDeadline) payable returns (uint256 bountyId)",
  "function submitCommitment(uint256 bountyId,bytes32 commitment)",
  "function revealAnswer(uint256 bountyId,string answer,bytes32 salt)",
  "function getBounty(uint256 bountyId) view returns (address owner,string title,string rubric,uint256 reward,uint256 commitDeadline,uint256 revealDeadline,bool judged,bool finalized,uint256 entryCountValue,uint256 revealedCount,uint256 winnerIndex,bytes aiReview)",
]);

function loadEnvFile(path: string) {
  const content = fs.readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, "");
    process.env[key] = value;
  }
}

function requiredPk(names: string[]): Hex {
  for (const name of names) {
    const raw = process.env[name];
    if (raw) return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  }
  throw new Error(`Missing one of: ${names.join(", ")}`);
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

loadEnvFile("../env.env");
const deployment = JSON.parse(fs.readFileSync("deployment.json", "utf8"));
const contractAddress = deployment.contractAddress as Hex;
const creator = privateKeyToAccount(requiredPk(["DEPLOYER_PRIVATE_KEY", "CREATOR_PRIVATE_KEY", "crerator and deployer key"]));
const user1 = privateKeyToAccount(requiredPk(["USER1_PRIVATE_KEY", "user1"]));
const user2 = privateKeyToAccount(requiredPk(["USER2_PRIVATE_KEY", "user2"]));

const publicClient = createPublicClient({ chain: ritual, transport: http() });
const creatorWallet = createWalletClient({ account: creator, chain: ritual, transport: http() });
const user1Wallet = createWalletClient({ account: user1, chain: ritual, transport: http() });
const user2Wallet = createWalletClient({ account: user2, chain: ritual, transport: http() });

const latestBlock = await publicClient.getBlock();
const now = latestBlock.timestamp;
const timestampUnit = now > 1_000_000_000_000n ? 1000n : 1n;
const commitSeconds = BigInt(process.env.COMMIT_SECONDS ?? "45");
const revealSeconds = BigInt(process.env.REVEAL_SECONDS ?? "180");
const commitDeadline = now + commitSeconds * timestampUnit;
const revealDeadline = commitDeadline + revealSeconds * timestampUnit;
const reward = parseEther("0.05");
const title = process.env["the qustion"] || "Privacy-preserving AI bounty judge demo";
const rubric = process.env.BOUNTY_RUBRIC || "Choose the answer that best explains a secure commit-reveal bounty lifecycle, handles edge cases, and keeps finalization human-controlled.";

console.log(`Contract ${contractAddress}`);
console.log(`Creator ${creator.address}`);
console.log(`User1 ${user1.address}`);
console.log(`User2 ${user2.address}`);
console.log(`Creating bounty with reward ${formatEther(reward)} RIT`);

const createHash = await creatorWallet.writeContract({
  address: contractAddress,
  abi,
  functionName: "createBounty",
  args: [title, rubric, commitDeadline, revealDeadline],
  value: reward,
});
console.log(`Create bounty tx ${createHash}`);
const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
const createdLogs = parseEventLogs({ abi, eventName: "BountyCreated", logs: createReceipt.logs });
const bountyId = createdLogs[0].args.bountyId;
console.log(`Bounty id ${bountyId.toString()}`);
console.log(`Commit deadline ${commitDeadline.toString()}`);
console.log(`Reveal deadline ${revealDeadline.toString()}`);

const answer1 = process.env.USER1_ANSWER || "Use commit-reveal so competitors first submit only keccak256(answer, salt, sender, bountyId), then reveal after the commit phase. Bind sender and bountyId to prevent copy/replay attacks.";
const answer2 = process.env.USER2_ANSWER || "Keep answers hidden until reveal, judge only verified reveals in one batch LLM request, and let the human owner finalize to handle AI mistakes and accountability.";
const salt1 = randomSalt("user1");
const salt2 = randomSalt("user2");
const commitment1 = commitment(bountyId, answer1, salt1, user1.address);
const commitment2 = commitment(bountyId, answer2, salt2, user2.address);

console.log("Submitting commitments...");
const commitHash1 = await user1Wallet.writeContract({ address: contractAddress, abi, functionName: "submitCommitment", args: [bountyId, commitment1] });
console.log(`User1 commitment tx ${commitHash1}`);
await publicClient.waitForTransactionReceipt({ hash: commitHash1 });
const commitHash2 = await user2Wallet.writeContract({ address: contractAddress, abi, functionName: "submitCommitment", args: [bountyId, commitment2] });
console.log(`User2 commitment tx ${commitHash2}`);
await publicClient.waitForTransactionReceipt({ hash: commitHash2 });

const waitSeconds = Math.max(Number((commitDeadline - (await publicClient.getBlock()).timestamp) / timestampUnit + 2n), 0);
if (waitSeconds > 0) {
  console.log(`Waiting ${waitSeconds}s for reveal phase...`);
  await sleep(waitSeconds * 1000);
}

console.log("Revealing answers...");
const revealHash1 = await user1Wallet.writeContract({ address: contractAddress, abi, functionName: "revealAnswer", args: [bountyId, answer1, salt1] });
console.log(`User1 reveal tx ${revealHash1}`);
await publicClient.waitForTransactionReceipt({ hash: revealHash1 });
const revealHash2 = await user2Wallet.writeContract({ address: contractAddress, abi, functionName: "revealAnswer", args: [bountyId, answer2, salt2] });
console.log(`User2 reveal tx ${revealHash2}`);
await publicClient.waitForTransactionReceipt({ hash: revealHash2 });

const bounty = await publicClient.readContract({ address: contractAddress, abi, functionName: "getBounty", args: [bountyId] });
const result = {
  contractAddress,
  bountyId: bountyId.toString(),
  createTx: createHash,
  user1CommitTx: commitHash1,
  user2CommitTx: commitHash2,
  user1RevealTx: revealHash1,
  user2RevealTx: revealHash2,
  commitDeadline: bounty[4].toString(),
  revealDeadline: bounty[5].toString(),
  entryCount: bounty[8].toString(),
  revealedCount: bounty[9].toString(),
};
fs.writeFileSync("demo-bounty.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));