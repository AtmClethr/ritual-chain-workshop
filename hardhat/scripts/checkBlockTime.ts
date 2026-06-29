import { createPublicClient, defineChain, http } from "viem";
const ritual = defineChain({ id: 1979, name: "Ritual Testnet", nativeCurrency: { name: "Ritual", symbol: "RIT", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.ritualfoundation.org"] } } });
const client = createPublicClient({ chain: ritual, transport: http() });
const block = await client.getBlock();
console.log(`block timestamp ${block.timestamp.toString()}`);