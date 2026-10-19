// Root grants the demo "relay-guild" signer a fresh seal. The latest root decision wins, so a
// previously revoked signer is trusted again until the next revoke. Used to replay the revoke demo.
import { privateKeyToAccount } from "viem/accounts";
import { grantParams, walletClient } from "../lib/writes.mjs";
import { keyFor, loadEnv, rpcUrl } from "./env.mjs";
import { logTx } from "./log.mjs";

loadEnv();
const root = walletClient(keyFor("root"), rpcUrl());
const signer = privateKeyToAccount(keyFor("compromised")).address;
const r = await root.createEntity(grantParams({ signer, label: "relay-guild", note: "Re-granted for the revoke demo" }));
logTx("regrant: root grants relay-guild a fresh seal", "root", r.txHash, [r.entityKey]);
console.log(`relay-guild sealed again: ${r.entityKey}\n  tx ${r.txHash}`);
process.exit(0);
