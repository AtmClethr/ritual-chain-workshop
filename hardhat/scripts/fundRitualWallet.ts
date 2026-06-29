import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";

const ritual = defineChain({ id: 1979, name: "Ritual Testnet", nativeCurrency: { name: "Ritual", symbol: "RIT", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.ritualfoundation.org"] } } });
const walletAddress = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948" as const;
const walletAbi = parseAbi(["function deposit(uint256 lockDuration) payable", "function balanceOf(address user) view returns (uint256)", "function lockUntil(address user) view returns (uint256)"]);
function loadEnvFile(path: string) { for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) { const t=line.trim(); if(!t||t.startsWith("#")) continue; const i=t.indexOf("="); if(i<0) continue; process.env[t.slice(0,i).trim()] = t.slice(i+1).trim().replace(/^['\"]|['\"]$/g, ""); } }
function pk(names: string[]): `0x${string}` { for (const name of names) { const raw=process.env[name]; if(raw) return (raw.startsWith("0x")?raw:`0x${raw}`) as `0x${string}`; } throw new Error("missing key"); }
loadEnvFile("../env.env");
const creator = privateKeyToAccount(pk(["DEPLOYER_PRIVATE_KEY", "CREATOR_PRIVATE_KEY", "crerator and deployer key"]));
const publicClient = createPublicClient({ chain: ritual, transport: http() });
const wallet = createWalletClient({ account: creator, chain: ritual, transport: http() });
const before = await publicClient.readContract({ address: walletAddress, abi: walletAbi, functionName: "balanceOf", args: [creator.address] });
console.log(`before balance=${formatEther(before)} RIT`);
if (before < parseEther("0.05")) {
  const hash = await wallet.writeContract({ address: walletAddress, abi: walletAbi, functionName: "deposit", args: [100000n], value: parseEther("0.05") });
  console.log(`deposit tx ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
} else {
  console.log("already funded, skipping deposit");
}
const [balance, lockUntil, blockNumber] = await Promise.all([
  publicClient.readContract({ address: walletAddress, abi: walletAbi, functionName: "balanceOf", args: [creator.address] }),
  publicClient.readContract({ address: walletAddress, abi: walletAbi, functionName: "lockUntil", args: [creator.address] }),
  publicClient.getBlockNumber(),
]);
console.log(`after balance=${formatEther(balance)} RIT lockUntil=${lockUntil} currentBlock=${blockNumber} ready=${balance >= parseEther("0.05") && lockUntil >= blockNumber + 300n}`);