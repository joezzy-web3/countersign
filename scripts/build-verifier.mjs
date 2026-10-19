// Builds web/verify.html: ONE self-contained file (no imports, no CDN, no fonts) that reads Arkiv
// over raw JSON-RPC and recomputes every verdict. It inlines the exact same engine the board uses,
// and test/verifier.test.mjs fails if the two ever drift.
//
//   npm run build:verifier

import { readFileSync, writeFileSync } from "node:fs";

const strip = (src) =>
  src
    .split("\n")
    .filter((l) => !/^import\s/.test(l))
    .join("\n")
    .replace(/^export\s+(?=(async\s+)?(function|const|let|class)\b)/gm, "");

const rpc = strip(readFileSync("web/core/rpc.js", "utf8"));
const verdict = strip(readFileSync("web/core/verdict.js", "utf8"));
const config = readFileSync("web/core/config.js", "utf8");
const root = config.match(/root: "(0x[0-9a-fA-F]{40})",\n  \/\/ Public/)[1];
const http = config.match(/rpcHttp: "([^"]+)"/)[1];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Countersign Verifier</title>
<meta name="description" content="Standalone verifier: reads Arkiv directly and recomputes every Countersign verdict. Save this file and it keeps working without countersign's servers." />
<style>
  :root { --bg:#fbf8f3; --ink:#1d1a16; --muted:#6b6258; --line:#e2d9cc; --ver:#1f7a5c; --imp:#b4232a; --rev:#6f6a64; --unv:#9a6a12; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#14120f; --ink:#f1e9dd; --muted:#a39685; --line:#3a332c; --ver:#4cc79c; --imp:#ff6b62; --rev:#b9b2a9; --unv:#e7b04b; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 20px 16px 40px; }
  h1 { font: 700 26px/1.2 Georgia, serif; margin: 6px 0; }
  p { color: var(--muted); }
  label { display:block; font-size:12px; color:var(--muted); margin-top:8px; }
  input { width:100%; font:13px ui-monospace, monospace; padding:8px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--ink); }
  button { margin-top:10px; font:600 14px system-ui; padding:9px 16px; border-radius:8px; border:1px solid var(--ink); background:var(--ink); color:var(--bg); cursor:pointer; }
  .mono { font-family: ui-monospace, monospace; font-size: 12.5px; word-break: break-all; }
  table { width:100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align: top; }
  .s { font-weight:700; text-transform:uppercase; font-size:11px; letter-spacing:.08em; }
  .verified { color: var(--ver); } .impostor { color: var(--imp); } .revoked { color: var(--rev); } .unverified { color: var(--unv); }
  pre { white-space: pre-wrap; word-break: break-all; font-size:12px; color: var(--muted); }
  .box { border:1px solid var(--line); border-radius:10px; padding:12px; margin-top:14px; }
  .scroll { overflow-x:auto; }
</style>
</head>
<body>
<main>
  <h1>Countersign Verifier</h1>
  <p>One file, zero dependencies. It reads Arkiv over raw JSON-RPC and recomputes every verdict with the
  same rules the board uses. Save it to your disk: it keeps working if countersign's website disappears.</p>
  <label for="rpc">Arkiv RPC (any node serving Tiramisu)</label>
  <input id="rpc" value="${http}" />
  <label for="root">Root of trust (the one address you choose to trust)</label>
  <input id="root" value="${root}" />
  <button id="go" type="button">Verify now</button>
  <div id="out"></div>
</main>
<script type="module">
// ---- inlined from web/core/rpc.js ----
${rpc}
// ---- inlined from web/core/verdict.js ----
${verdict}
// ---- verifier UI ----
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
// Trust pinning (idea credit: Mirrorlease): remember the root you confirmed, warn loudly if it changes.
const PIN = "countersign.pinnedRoot";
function pinNote(root) {
  let saved = null;
  try { saved = localStorage.getItem(PIN); } catch {}
  if (!saved) {
    try { localStorage.setItem(PIN, root.toLowerCase()); } catch {}
    return \`<p>Pinned this root in your browser. If a later copy of this page shows a different one, you will be warned.</p>\`;
  }
  if (saved !== root.toLowerCase()) {
    return \`<p class="impostor"><b>Warning:</b> you previously pinned root <span class="mono">\${saved}</span>. This page now uses <span class="mono">\${esc(root)}</span>. Only continue if you got the new root from a channel you trust. <button type="button" id="repin">Pin the new root</button></p>\`;
  }
  return "<p>Root matches the one you pinned earlier.</p>";
}
async function run() {
  const out = document.getElementById("out");
  const url = document.getElementById("rpc").value.trim();
  const root = document.getElementById("root").value.trim();
  out.innerHTML = "<p>Reading Arkiv…</p>";
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(root)) throw new Error("Root must be a 0x address");
    const chain = await rpc(url, "eth_chainId", []);
    const snap = await loadSnapshot(url, root);
    const board = judgeBoard(snap, root);
    const digest = await boardDigest(board);
    const rows = board.alerts.map((a) => \`<tr><td class="s \${a.verdict.status}">\${a.verdict.status}</td><td>\${esc(a.payload?.title)}<br><span class="mono">\${esc(a.attrs.target)}</span></td><td class="mono">\${esc(a.creator)}</td><td>\${esc(a.verdict.reason)}<br>\${a.cosigners.length} sealed countersign(s)</td></tr>\`).join("");
    const seals = [...board.trust.signers].map(([addr, s]) => \`<tr><td class="s \${s.state === "active" ? "verified" : s.state === "revoked" ? "revoked" : "unverified"}">\${s.state}</td><td>\${esc(s.label)}</td><td class="mono">\${addr}</td></tr>\`).join("");
    out.innerHTML = \`
      <div class="box">\${pinNote(root)}</div>
      <div class="box"><b>Chain</b> \${parseInt(chain, 16)} · <b>block</b> \${board.head} · <b>verdicts</b> \${JSON.stringify(board.counts)}
      <div class="mono" style="margin-top:6px">digest \${digest}</div>
      <p style="margin:6px 0 0">Compare this digest with the board's at the same block: identical means an independent reader reached identical verdicts.</p></div>
      <div class="box scroll"><b>Seals granted by the root</b><table><tr><th>state</th><th>label</th><th>signer ($creator of its alerts)</th></tr>\${seals}</table></div>
      <div class="box scroll"><b>Alerts</b><table><tr><th>verdict</th><th>alert</th><th>$creator</th><th>why</th></tr>\${rows}</table></div>
      <div class="box"><b>Exact queries sent (arkiv_query)</b><pre>\${esc(Object.entries(snap.queries).map(([k, q]) => "# " + k + "\\n" + q).join("\\n\\n"))}</pre></div>\`;
  } catch (err) {
    out.innerHTML = \`<div class="box"><b class="impostor">Could not verify:</b> \${esc(err.message)}</div>\`;
  }
}
document.getElementById("go").addEventListener("click", run);
document.addEventListener("click", (e) => {
  if (e.target.id === "repin") { try { localStorage.setItem(PIN, document.getElementById("root").value.trim().toLowerCase()); } catch {} run(); }
});
run();
</script>
</body>
</html>
`;

writeFileSync("web/verify.html", html);
console.log("Wrote web/verify.html", `(${(html.length / 1024).toFixed(1)} KB, root ${root})`);
