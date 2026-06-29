import { createPublicClient, defineChain, formatEther, http, parseAbi } from "viem";
import fs from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const ritual = defineChain({ id: 1979, name: "Ritual Testnet", nativeCurrency: { name: "Ritual", symbol: "RIT", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.ritualfoundation.org"] } } });
const walletAbi = parseAbi(["function balanceOf(address user) view returns (uint256)", "function lockUntil(address user) view returns (uint256)"]);
const bountyAbi = parseAbi(["function getBounty(uint256 bountyId) view returns (address owner,string title,string rubric,uint256 reward,uint256 commitDeadline,uint256 revealDeadline,bool judged,bool finalized,uint256 entryCountValue,uint256 revealedCount,uint256 winnerIndex,bytes aiReview)"]);
function loadEnvFile(path: string) { for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) { const t=line.trim(); if(!t||t.startsWith("#")) continue; const i=t.indexOf("="); if(i<0) continue; process.env[t.slice(0,i).trim()] = t.slice(i+1).trim().replace(/^['\"]|['\"]$/g, ""); } }
function pk(names: string[]): `0x${string}` { for (const name of names) { const raw=process.env[name]; if(raw) return (raw.startsWith("0x")?raw:`0x${raw}`) as `0x${string}`; } throw new Error("missing key"); }
loadEnvFile("../env.env");
const creator = privateKeyToAccount(pk(["DEPLOYER_PRIVATE_KEY", "CREATOR_PRIVATE_KEY", "crerator and deployer key"]));
const deployment = JSON.parse(fs.readFileSync("deployment.json", "utf8"));
const demo = JSON.parse(fs.readFileSync("demo-bounty.json", "utf8"));
const publicClient = createPublicClient({ chain: ritual, transport: http() });
const [balance, lockUntil, blockNumber, block, bounty] = await Promise.all([
  publicClient.readContract({ address: "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948", abi: walletAbi, functionName: "balanceOf", args: [creator.address] }),
  publicClient.readContract({ address: "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948", abi: walletAbi, functionName: "lockUntil", args: [creator.address] }),
  publicClient.getBlockNumber(),
  publicClient.getBlock(),
  publicClient.readContract({ address: deployment.contractAddress, abi: bountyAbi, functionName: "getBounty", args: [BigInt(demo.bountyId)] }),
]);
console.log(`creator=${creator.address}`);
console.log(`creator native=${formatEther(await publicClient.getBalance({ address: creator.address }))} RIT`);
console.log(`ritualWallet balance=${formatEther(balance)} RIT lockUntil=${lockUntil} currentBlock=${blockNumber}`);
console.log(`bounty reward=${formatEther(bounty[3])} RIT entries=${bounty[8]} revealed=${bounty[9]} judged=${bounty[6]} finalized=${bounty[7]}`);
console.log(`chain timestamp=${block.timestamp} revealDeadline=${bounty[5]} readyForJudge=${block.timestamp >= bounty[5]}`);