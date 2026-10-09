// 前端构建：打包、压缩、按内容 hash 命名，输出到 dist/。
// wrangler dev / wrangler deploy 会通过 wrangler.toml 的 [build] 自动调用本脚本。
import * as esbuild from "esbuild";
import subsetFont from "subset-font";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "frontend");
const outDir = path.join(root, "dist");
const assetsDir = path.join(outDir, "assets");
const watch = process.argv.includes("--watch");
const minify = !process.argv.includes("--no-minify");

/**
 * 生成 Lucide 图标字体的核心子集：只包含前端代码里出现过的图标（界面按钮、默认/推荐图标等）。
 * 样式里字体栈为 'lucide-core', 'lucide'，核心子集声明了 unicode-range，
 * 用户数据里用到子集之外的图标时，浏览器才会按需下载完整字体（约 260KB）。
 */
async function buildIconSubset() {
  const fontsDir = path.join(srcDir, "fonts");
  // 生成物放在 frontend/ 之外，避免触发 wrangler dev 的 watch_dir 造成重复构建。
  const genDir = path.join(root, ".cache", "icons");
  await mkdir(genDir, { recursive: true });

  const css = await readFile(path.join(fontsDir, "lucide.css"), "utf8");
  const codepoints = new Map();
  for (const match of css.matchAll(/\.icon-([a-z0-9-]+)::before\s*\{\s*content:\s*"\\([0-9a-f]+)"/g)) {
    codepoints.set(match[1], parseInt(match[2], 16));
  }

  const used = new Set();
  const files = (await readdir(srcDir, { recursive: true })).filter((file) => file.endsWith(".js"));
  const sources = await Promise.all(files.map((file) => readFile(path.join(srcDir, file), "utf8")));
  for (const source of sources) {
    for (const match of source.matchAll(/["'`](?:icon-)?([a-z0-9]+(?:-[a-z0-9]+)*)["'`\s]/g)) {
      if (codepoints.has(match[1])) used.add(codepoints.get(match[1]));
    }
    for (const match of source.matchAll(/icon-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      if (codepoints.has(match[1])) used.add(codepoints.get(match[1]));
    }
  }
  const points = Array.from(used).sort((a, b) => a - b);
  const full = await readFile(path.join(fontsDir, "lucide.woff2"));
  const subset = await subsetFont(full, String.fromCodePoint(...points), { targetFormat: "woff2" });
  await writeFile(path.join(genDir, "lucide-core.woff2"), subset);

  const range = points.map((cp) => "U+" + cp.toString(16).toUpperCase()).join(", ");
  await writeFile(path.join(genDir, "core.css"), `/* 由 scripts/build.mjs 生成，请勿手动修改 */
@font-face {
  font-family: "lucide-core";
  src: url("./lucide-core.woff2") format("woff2");
  font-display: block;
  unicode-range: ${range};
}
`);
  return { count: points.length, bytes: subset.length };
}

async function build() {
  // 不先清空 dist/：wrangler dev 正在读取时删除目录会导致资源清单失效。先写新文件，最后删除旧文件。
  await mkdir(assetsDir, { recursive: true });
  const icons = await buildIconSubset();
  console.log(`[build] icon subset: ${icons.count} glyphs, ${(icons.bytes / 1024).toFixed(1)} KB`);

  const result = await esbuild.build({
    entryPoints: {
      app: path.join(srcDir, "main.js"),
      styles: path.join(srcDir, "styles.css")
    },
    outdir: assetsDir,
    entryNames: "[name]-[hash]",
    assetNames: "[name]-[hash]",
    bundle: true,
    minify,
    sourcemap: "linked",
    format: "iife",
    target: ["es2019", "chrome80", "safari13", "firefox78"],
    loader: { ".woff2": "file" },
    metafile: true,
    logLevel: "warning"
  });

  const outputs = Object.keys(result.metafile.outputs).map((file) => path.relative(outDir, path.join(root, file)).split(path.sep).join("/"));
  const js = outputs.find((file) => /^assets\/app-.*\.js$/.test(file));
  const css = outputs.find((file) => /^assets\/styles-.*\.css$/.test(file));
  if (!js || !css) throw new Error("build outputs missing: " + outputs.join(", "));

  // 字体预加载：核心子集字体在首屏就会用到。
  const fontPreloads = outputs
    .filter((file) => /^assets\/lucide-core-.*\.woff2$/.test(file))
    .map((file) => `  <link rel="preload" href="/${file}" as="font" type="font/woff2" crossorigin>`)
    .join("\n");

  let html = await readFile(path.join(srcDir, "index.html"), "utf8");
  html = html
    .replace("<!-- build:css -->", `<link rel="stylesheet" href="/${css}">` + (fontPreloads ? "\n" + fontPreloads : ""))
    .replace("<!-- build:js -->", `<script src="/${js}" defer></script>`);
  await writeFile(path.join(outDir, "index.html"), html);
  await copyFile(path.join(srcDir, "_headers"), path.join(outDir, "_headers"));

  const keep = new Set(outputs.map((file) => path.basename(file)));
  for (const file of await readdir(assetsDir)) {
    if (!keep.has(file)) await rm(path.join(assetsDir, file), { force: true });
  }

  const sizes = await Promise.all(outputs.filter((f) => !f.endsWith(".map")).map(async (file) => {
    const data = await readFile(path.join(outDir, file));
    return `${file}  ${(data.length / 1024).toFixed(1)} KB`;
  }));
  const hash = createHash("sha1").update(html).digest("hex").slice(0, 8);
  console.log(`[build] dist/ ready (${hash})\n  ` + sizes.join("\n  "));
}

await build();

if (watch) {
  const { watch: fsWatch } = await import("node:fs");
  let timer = null;
  fsWatch(srcDir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((error) => console.error(error)), 100);
  });
  console.log("[build] watching frontend/ ...");
}
