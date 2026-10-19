// Bundles the 3D hero (web/src/seal3d.js + the parts of three.js it uses) into one minified,
// self-hosted file: web/vendor/seal3d.js. No CDN at runtime.
//
//   npm i --no-save three esbuild && npm run build:seal
//
// The built file is committed, so the site deploys without this step.
import { build } from "esbuild";

await build({
  entryPoints: ["web/src/seal3d.js"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  outfile: "web/vendor/seal3d.js",
  legalComments: "eof",
  logLevel: "info",
});
