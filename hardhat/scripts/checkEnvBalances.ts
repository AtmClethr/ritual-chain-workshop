import { createPublicClient, defineChain, formatEther, http } from "viem";
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

function pk(names: string[]) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw) return { name, value: (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}` };
  }
  return null;
}

loadEnvFile("../env.env");
const vars = [
  ["creator", ["DEPLOYER_PRIVATE_KEY", "CREATOR_PRIVATE_KEY", "CREATOR_KEY", "creator", "crerator key", "crerator and deployer key"]],
  ["user1", ["USER1_PRIVATE_KEY", "USER1_KEY", "user1"]],
  ["user2", ["USER2_PRIVATE_KEY", "USER2_KEY", "user2"]],
] as const;
const publicClient = createPublicClient({ chain: ritual, transport: http() });
for (const [label, names] of vars) {
  const item = pk([...names]);
  if (!item) {
    console.log(`${label}: MISSING`);
    continue;
  }
  const account = privateKeyToAccount(item.value);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`${label}: env=${item.name}, address=${account.address}, balance=${formatEther(balance)} RIT`);
}