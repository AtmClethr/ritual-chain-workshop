import { createPublicClient, createWalletClient, defineChain, formatEther, http } from "viem";
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
const deployer = privateKeyToAccount(requiredPk(["DEPLOYER_PRIVATE_KEY", "CREATOR_PRIVATE_KEY", "crerator and deployer key"]));
const artifact = JSON.parse(fs.readFileSync("artifacts/contracts/CommitRevealBounty.sol/CommitRevealBounty.json", "utf8"));
const publicClient = createPublicClient({ chain: ritual, transport: http() });
const wallet = createWalletClient({ account: deployer, chain: ritual, transport: http() });

console.log(`Deployer ${deployer.address}`);
console.log(`Deployer balance ${formatEther(await publicClient.getBalance({ address: deployer.address }))} RIT`);
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode });
console.log(`Deploy tx ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) throw new Error("No contract address in deploy receipt");
console.log(`Contract ${receipt.contractAddress}`);
console.log(`Gas used ${receipt.gasUsed.toString()}`);

fs.writeFileSync("../web/.env.local", `NEXT_PUBLIC_CONTRACT_ADDRESS=${receipt.contractAddress}\n`, "utf8");
fs.writeFileSync("deployment.json", JSON.stringify({ contractAddress: receipt.contractAddress, deployTx: hash, deployer: deployer.address }, null, 2));