// Renders arkiv/smoke-results.json into the "Paths that worked" table of arkiv/friction.md.
import { readFileSync, writeFileSync } from "node:fs";

const r = JSON.parse(readFileSync("arkiv/smoke-results.json", "utf8"));
const cell = (v) =>
  String(typeof v === "object" ? JSON.stringify(v) : v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .slice(0, 220);

const lines = [
  `Run ${r.ranAt} against \`${r.rpc}\`. SDK ${r.versions.sdk}, viem ${r.versions.viem}, Node ${r.versions.node}, ${r.versions.os}.`,
  "",
  "| step | as expected | ms | expected | actual |",
  "|---|---|---|---|---|",
  ...r.results.map(
    (x) => `| ${cell(x.step)} | ${x.ok ? "yes" : "**no**"} | ${x.ms} | ${cell(x.expected)} | ${cell(x.actual ?? x.error)}${x.note ? ` (${cell(x.note)})` : ""} |`,
  ),
];

const path = "arkiv/friction.md";
const md = readFileSync(path, "utf8").replace(
  /<!-- SMOKE:START -->[\s\S]*<!-- SMOKE:END -->/,
  `<!-- SMOKE:START -->\n${lines.join("\n")}\n<!-- SMOKE:END -->`,
);
writeFileSync(path, md);
console.log(`friction.md updated with ${r.results.length} smoke steps`);
