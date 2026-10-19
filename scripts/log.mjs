// Appends every transaction the scripts send to arkiv/onchain-log.json.
// Public data only: labels, wallet names, tx hashes, entity keys.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PATH = "arkiv/onchain-log.json";

export function logTx(what, wallet, txHash, entityKeys = []) {
  const log = existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : [];
  log.push({ at: new Date().toISOString(), what, wallet, txHash, entityKeys });
  writeFileSync(PATH, JSON.stringify(log, null, 2) + "\n");
}
