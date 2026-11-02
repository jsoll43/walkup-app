// Build only the standalone baseball app. The existing Vite/BGSL build is unchanged.
import { build } from "esbuild";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = path.join(root, "public/baseball");
await mkdir(outdir, { recursive: true });
for (const name of await readdir(outdir)) {
  if (/^app-[A-Z0-9]+\.(js|css)$/.test(name)) await rm(path.join(outdir, name));
}
const result = await build({
  absWorkingDir: root,
  entryPoints: { app: "src/baseball/main.jsx" },
  entryNames: "[name]-[hash]",
  outdir,
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  legalComments: "eof",
});
const outputs = Object.keys(result.metafile.outputs);
const js = path.basename(outputs.find((file) => file.endsWith(".js")));
const css = path.basename(outputs.find((file) => file.endsWith(".css")));
await writeFile(path.join(root, "public/baseball.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#071e47" />
    <meta name="description" content="Barrington Little League field scheduling for Majors, Minors, and Tee Ball. Request and manage two-hour field reservations." />
    <title>Barrington Little League | Field Scheduling</title>
    <link rel="icon" type="image/svg+xml" href="/baseball/logo.svg" />
    <link rel="stylesheet" href="/baseball/${css}" />
    <script type="module" src="/baseball/${js}"></script>
  </head>
  <body>
    <div id="root"></div>
    <noscript>Please enable JavaScript to use Barrington Little League field scheduling.</noscript>
  </body>
</html>
`);
console.log(`Built baseball app: ${js}, ${css}`);
