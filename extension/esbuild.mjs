// Bundles the extension into dist/. Load-unpacked points Chrome at extension/dist.
// content.js is an IIFE (injected as a classic script via executeScript);
// background.js and popup.js are ES modules (module worker + <script type=module>).
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const common = { bundle: true, target: "chrome120", logLevel: "info", legalComments: "none" };

await mkdir("dist", { recursive: true });

await Promise.all([
  build({ ...common, entryPoints: ["src/content.ts"], outfile: "dist/content.js", format: "iife" }),
  build({ ...common, entryPoints: ["src/relay.ts"], outfile: "dist/relay.js", format: "iife" }),
  build({ ...common, entryPoints: ["src/background.ts"], outfile: "dist/background.js", format: "esm" }),
  build({ ...common, entryPoints: ["src/popup.ts"], outfile: "dist/popup.js", format: "esm" }),
]);

await cp("manifest.json", "dist/manifest.json");
await cp("popup.html", "dist/popup.html");

console.log("built extension → dist/");
