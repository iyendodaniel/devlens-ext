const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * scanner.py is bundled data, not compiled code — esbuild only touches
 * .ts, so it's copied into dist/ manually on every build. scannerService.ts
 * looks for it at `context.extensionUri/dist/scanner.py`.
 */
function copyScanner() {
  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, "scripts", "scanner.py"),
    path.join(__dirname, "dist", "scanner.py"),
  );
}

async function main() {
  copyScanner();

  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "info",
  });

  if (watch) {
    await ctx.watch();
    fs.watchFile(path.join(__dirname, "scripts", "scanner.py"), copyScanner);
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
