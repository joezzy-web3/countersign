// Root revokes a signer. Every alert that signer ever posted turns REVOKED on every viewer,
// live, because the verdict is recomputed from chain state.
//
//   npm run revoke                 revokes the demo "compromised" signer (relay-guild)
//   npm run revoke -- 0xADDRESS    revokes any signer the root granted

import { CONFIG } from "../web/core/config.js";
import { Q, queryAll } from "../web/core/rpc.js";
import { revokeParams, walletClient } from "../lib/writes.mjs";
import { privateKeyToAccount } from "viem/accounts";
import { keyFor, loadEnv, rpcUrl } from "./env.mjs";
import { logTx } from "./log.mjs";

loadEnv();
const url = rpcUrl();
const root = walletClient(keyFor("root"), url);
const signer = (process.argv[2] ?? privateKeyToAccount(keyFor("compromised")).address).toLowerCase();

const grants = (await queryAll(url, Q.grants(CONFIG.root))).entities.filter((g) => g.attrs.signer === signer);
if (!grants.length) {
  console.error(`No live grant from the root for ${signer}. Nothing to revoke.`);
  process.exit(1);
}
const grant = grants.sort((x, y) => y.createdAt - x.createdAt)[0];

const r = await root.createEntity(
  revokeParams({
    signer,
    grantKey: grant.key,
    reason: "Signing key reported compromised (demo scenario).",
  }),
);
logTx(`revoke: root revokes ${grant.attrs.label} (${signer})`, "root", r.txHash, [r.entityKey]);
console.log(`Revoked ${grant.attrs.label} ${signer}\n  revoke entity ${r.entityKey}\n  tx ${r.txHash}`);

process.exit(0); // done: close open RPC connections so the terminal returns
