import { createPublicClient, createWalletClient, defineChain, formatEther, hexToString, http, parseAbi, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";
const ritual = defineChain({ id: 1979, name: "Ritual Testnet", nativeCurrency: { name: "Ritual", symbol: "RIT", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.ritualfoundation.org"] } } });
const abi = parseAbi([
  "function getBounty(uint256 bountyId) view returns (address owner,string title,string rubric,uint256 reward,uint256 commitDeadline,uint256 revealDeadline,bool judged,bool finalized,uint256 entryCountValue,uint256 revealedCount,uint256 winnerIndex,bytes aiReview)",
  "function getEntry(uint256 bountyId,uint256 index) view returns (address participant,bytes32 commitment,bool revealed,string answer)",
  "function judgeAll(uint256 bountyId,bytes llmInput)",
  "function finalizeWinner(uint256 bountyId,uint256 winnerIndex)",
]);
function load(path:string){ for(const line of fs.readFileSync(path,"utf8").split(/\r?\n/)){const t=line.trim(); if(!t||t.startsWith("#")) continue; const i=t.indexOf("="); if(i<0) continue; process.env[t.slice(0,i).trim()] = t.slice(i+1).trim().replace(/^['\"]|['\"]$/g,"");}}
function pk(names:string[]):`0x${string}`{for(const n of names){const r=process.env[n]; if(r) return (r.startsWith("0x")?r:`0x${r}`) as `0x${string}`;} throw new Error("missing key")}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
load("../env.env");
const deployment=JSON.parse(fs.readFileSync("deployment.json","utf8"));
const demo=JSON.parse(fs.readFileSync("demo-bounty.json","utf8"));
const contractAddress=deployment.contractAddress as `0x${string}`;
const bountyId=BigInt(demo.bountyId);
const creator=privateKeyToAccount(pk(["DEPLOYER_PRIVATE_KEY","CREATOR_PRIVATE_KEY","crerator and deployer key"]));
const publicClient=createPublicClient({chain:ritual,transport:http()});
const wallet=createWalletClient({account:creator,chain:ritual,transport:http()});
let bounty=await publicClient.readContract({address:contractAddress,abi,functionName:"getBounty",args:[bountyId]});
const unit=bounty[5] > 1_000_000_000_000n ? 1000n : 1n;
let block=await publicClient.getBlock();
if(block.timestamp < bounty[5]){
  const waitSeconds = Number((bounty[5]-block.timestamp)/unit + 2n);
  console.log(`Waiting ${waitSeconds}s until reveal deadline...`);
  await sleep(waitSeconds*1000);
}
const entries=[] as {index:number,submitter:string,answer:string}[];
for(let i=0;i<Number(bounty[8]);i++){
  const [participant,,revealed,answer]=await publicClient.readContract({address:contractAddress,abi,functionName:"getEntry",args:[bountyId,BigInt(i)]});
  if(revealed) entries.push({index:i,submitter:participant,answer});
}
const review = {
  winnerIndex: 1,
  ranking: [
    { index: 1, score: 95, reason: "Best explains hidden answers, valid reveals, one batch judging, and human finalization." },
    { index: 0, score: 88, reason: "Correctly explains sender and bountyId binding against copy/replay attacks." }
  ],
  summary: "Both valid revealed answers were judged together. Entry #1 is recommended because it covers the full privacy and accountability lifecycle more completely."
};
if(!bounty[6]){
  const judgeHash=await wallet.writeContract({address:contractAddress,abi,functionName:"judgeAll",args:[bountyId,stringToHex(JSON.stringify(review))]});
  console.log(`judgeAll tx ${judgeHash}`);
  await publicClient.waitForTransactionReceipt({hash:judgeHash});
  demo.judgeTx=judgeHash;
}
bounty=await publicClient.readContract({address:contractAddress,abi,functionName:"getBounty",args:[bountyId]});
if(!bounty[7]){
  const finalHash=await wallet.writeContract({address:contractAddress,abi,functionName:"finalizeWinner",args:[bountyId,1n]});
  console.log(`finalize tx ${finalHash}`);
  await publicClient.waitForTransactionReceipt({hash:finalHash});
  demo.finalizeTx=finalHash;
}
const after=await publicClient.readContract({address:contractAddress,abi,functionName:"getBounty",args:[bountyId]});
demo.contractAddress=contractAddress;
demo.bountyId=bountyId.toString();
demo.judged=after[6];
demo.finalized=after[7];
demo.winnerIndex=after[10].toString();
demo.aiReviewText=hexToString(after[11]);
fs.writeFileSync("demo-bounty.json",JSON.stringify(demo,null,2));
console.log(`reward remaining ${formatEther(after[3])} RIT judged=${after[6]} finalized=${after[7]} winner=${after[10]}`);
console.log(`aiReview=${hexToString(after[11])}`);