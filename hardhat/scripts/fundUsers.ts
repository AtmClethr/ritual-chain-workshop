import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";

const ritual = defineChain({
  id: 1979,
  name: "Ritual Testnet",
  nativeCurrency: { name: "Ritual", symbol: "RIT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.ritualfoundation.org"] } },
});

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

function requiredPk(names: string[]): `0x${string}` {
  for (const name of names) {
    const raw = process.env[name];
    if (raw) return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  }
  throw new Error(`Missing one of: ${names.join(", ")}`);
}

loadEnvFile("../env.env");
const creator = privateKeyToAccount(requiredPk(["DEPLOYER_PRIVATE_KEY", "CREATOR_PRIVATE_KEY", "crerator and deployer key"]));
const user1 = privateKeyToAccount(requiredPk(["USER1_PRIVATE_KEY", "user1"]));
const user2 = privateKeyToAccount(requiredPk(["USER2_PRIVATE_KEY", "user2"]));

const publicClient = createPublicClient({ chain: ritual, transport: http() });
const wallet = createWalletClient({ account: creator, chain: ritual, transport: http() });
const amount = parseEther("0.01");

async function fund(label: string, to: `0x${string}`) {
  const before = await publicClient.getBalance({ address: to });
  if (before >= amount) {
    console.log(`${label} already has ${formatEther(before)} RIT, skipping`);
    return;
  }
  const hash = await wallet.sendTransaction({ to, value: amount });
  console.log(`${label} funding tx ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.getBalance({ address: to });
  console.log(`${label} balance ${formatEther(after)} RIT`);
}

console.log(`Creator ${creator.address}`);
console.log(`User1 ${user1.address}`);
console.log(`User2 ${user2.address}`);
await fund("user1", user1.address);
await fund("user2", user2.address);
const creatorBal = await publicClient.getBalance({ address: creator.address });
console.log(`creator balance ${formatEther(creatorBal)} RIT`);