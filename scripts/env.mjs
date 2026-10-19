// Tiny .env loader (no dependency). Never prints secret values.
import { existsSync, readFileSync } from "node:fs";

export const WALLETS = ["root", "sentinel", "watchtower", "compromised", "impostor"];
export const envName = (w) => `KEY_${w.toUpperCase()}`;

export function loadEnv(path = ".env") {
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return process.env;
}

export function rpcUrl() {
  return process.env.ARKIV_RPC_URL || "https://rpc.tiramisu.db-chain.testnet.arkiv.network";
}

export function keyFor(wallet) {
  const k = process.env[envName(wallet)];
  if (!k) throw new Error(`${envName(wallet)} is not set. Run "npm run keys" first.`);
  return k;
}
