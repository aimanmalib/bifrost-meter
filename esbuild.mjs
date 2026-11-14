// Bundles every entry point that exists into dist/. Entry points are added as the extension, MCP server and CLI land.
import { build } from 'esbuild';
import { existsSync } from 'node:fs';

const production = process.argv.includes('--production');

const targets = [
  { entry: 'src/extension/extension.ts', out: 'dist/extension.js', external: ['vscode'] },
  { entry: 'src/mcp/server.ts', out: 'dist/mcp.js', external: [] },
  { entry: 'src/cli/cli.ts', out: 'dist/cli.js', external: [] },
  // The core is always bundled once on its own, so a broken import graph fails the build even before the entry points exist.
  { entry: 'src/core/index.ts', out: 'dist/core.js', external: [] },
].filter((t) => existsSync(t.entry));

for (const t of targets) {
  await build({
    entryPoints: [t.entry],
    outfile: t.out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: t.external,
    sourcemap: !production,
    minify: production,
    logLevel: 'warning',
  });
  console.log(`built ${t.out}`);
}
