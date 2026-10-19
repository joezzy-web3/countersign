// Splits the root wallet's testnet GLM across the other four demo wallets,
// so you only need to use the faucet once (for the root).

import { formatEther } from "viem";
import { publicClient, walletClient } from "../lib/writes.mjs";
import { WALLETS, keyFor, loadEnv, rpcUrl } from "./env.mjs";
import { privateKeyToAccount } from "viem/accounts";

loadEnv();
const url = rpcUrl();
const pub = publicClient(url);
const root = walletClient(keyFor("root"), url);

const balance = await pub.getBalance({ address: root.account.address });
console.log(`root ${root.account.address} holds ${formatEther(balance)} GLM`);
if (balance === 0n) {
  console.error("Root has no funds. Use https://hub.arkiv.network/faucet for the root address first.");
  process.exit(1);
}

const share = (balance * 15n) / 100n; // 15% to each of 4 wallets, root keeps ~40% for grants and seeds
for (const w of WALLETS.filter((x) => x !== "root")) {
  const to = privateKeyToAccount(keyFor(w)).address;
  const hash = await root.sendTransaction({ to, value: share });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  sent ${formatEther(share)} GLM to ${w.padEnd(12)} ${to}  tx ${hash}`);
}
for (const w of WALLETS) {
  const a = privateKeyToAccount(keyFor(w)).address;
  console.log(`  ${w.padEnd(12)} ${formatEther(await pub.getBalance({ address: a }))} GLM`);
}

process.exit(0); // done: close open RPC connections so the terminal returns
