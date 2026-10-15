import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const read = async (path) => readFile(resolve(root, path), "utf8");
let html = await read("index.html");
const [baseCss, featureCss, appJs] = await Promise.all([
  read("styles.css"), read("features.css"), read("app.js"),
]);
html = html.replace('<link rel="stylesheet" href="styles.css">', "");
html = html.replace('<link rel="stylesheet" href="features.css">', "");
html = html.replace('<script src="app.js" defer></script>', "");
html = html.replace("</head>", `<style>${baseCss}\n${featureCss}</style>\n</head>`);
html = html.replace("</body>", `<script>${appJs}</script>\n</body>`);
const manifest = await read(".openai/hosting.json");
const worker = (await read("worker/index.js"))
  .replace("env.ASSETS", JSON.stringify(html))
  .replace("env.MANIFEST", JSON.stringify(await read("manifest.webmanifest")));
const out = resolve(root, "dist");
await mkdir(resolve(out, "server"), { recursive: true });
await mkdir(resolve(out, ".openai"), { recursive: true });
await writeFile(resolve(out, "server/index.js"), worker);
await writeFile(resolve(out, ".openai/hosting.json"), manifest);
console.log(`Built Worker bundle in ${out}`);
