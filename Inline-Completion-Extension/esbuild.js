const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

(async () => {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    outfile: "out/extension.js",
    external: ["vscode"],
    sourcemap: true
  });

  if (watch) {
    await ctx.watch();
    console.log("👀 Watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("✅ Build completed");
  }
})();
