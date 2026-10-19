// Generates the five demo wallets, writes their keys to .env (git-ignored) and their public
// addresses to web/core/config.js. Never prints a private key.
//
//   npm run keys            create .env if it does not exist
//   npm run keys -- --sync  only rewrite config.js from an existing .env

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { WALLETS, envName, loadEnv } from "./env.mjs";

const sync = process.argv.includes("--sync");

if (!sync) {
  if (existsSync(".env") && WALLETS.some((w) => readFileSync(".env", "utf8").includes(envName(w)))) {
    console.error(".env already holds keys. Refusing to overwrite. Use --sync to refresh config.js.");
    process.exit(1);
  }
  const lines = [
    "# Countersign demo wallets (Tiramisu testnet only). NEVER commit this file.",
    "ARKIV_RPC_URL=https://rpc.tiramisu.db-chain.testnet.arkiv.network",
    ...WALLETS.map((w) => `${envName(w)}=${generatePrivateKey()}`),
    "",
  ];
  writeFileSync(".env", lines.join("\n"), { mode: 0o600 });
  console.log("Wrote .env with 5 new testnet keys.");
}

loadEnv();
const addresses = Object.fromEntries(
  WALLETS.map((w) => [w, privateKeyToAccount(process.env[envName(w)]).address]),
);

const configPath = "web/core/config.js";
let config = readFileSync(configPath, "utf8");
config = config.replace(/root: "0x[0-9a-fA-F]{40}",\n  \/\/ Public/, `root: "${addresses.root}",\n  // Public`);
for (const w of WALLETS) {
  config = config.replace(new RegExp(`(\\n    ${w}: )"0x[0-9a-fA-F]{40}"`), `$1"${addresses[w]}"`);
}
writeFileSync(configPath, config);

writeFileSync(
  "arkiv/wallets.md",
  [
    "# Wallets that create Countersign's entities on Tiramisu (chain 7738577)",
    "",
    "Public addresses only. Every Countersign entity in the demo was created by one of these five wallets.",
    "",
    "| role | address | creates |",
    "|---|---|---|",
    `| root of trust | \`${addresses.root}\` | grant, revoke |`,
    `| tiramisu-sentinel (demo signer) | \`${addresses.sentinel}\` | alert, cosign |`,
    `| watchtower-dao (demo signer, also /api/cosign) | \`${addresses.watchtower}\` | alert, cosign |`,
    `| relay-guild (signer revoked in the demo) | \`${addresses.compromised}\` | alert |`,
    `| impostor (also /api/attack) | \`${addresses.impostor}\` | alert, cosign |`,
    "",
    "Explorer: https://tiramisu.explorer.arkiv.network. Every transaction the scripts sent is in arkiv/onchain-log.json.",
    "",
  ].join("\n"),
);

console.log("\nPublic addresses (safe to share, these go in the submission):");
for (const w of WALLETS) console.log(`  ${w.padEnd(12)} ${addresses[w]}`);
console.log(`\nNext: fund the ROOT address at https://hub.arkiv.network/faucet, then run "npm run fund".`);

await import("./build-verifier.mjs"); // verify.html carries the root address too
