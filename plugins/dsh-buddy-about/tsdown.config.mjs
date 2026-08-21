// Build for the dsh client loader: a single CJS bundle wrapped in the
// window.__ModuleLoader__.load({id, factory}) envelope (same shape as the
// official client bundles and @linxin666/dsh-pet). react stays external —
// the loader resolves it from the host at runtime. The buddy version is
// stamped from package.json at build time (single source).
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  entry: ['src/client/index.js'],
  format: ['cjs'],
  outDir: 'lib',
  deps: { neverBundle: [/^react($|\/)/, /^react-dom($|\/)/, /^@deepseek-ai\//] },
  define: {
    __DSH_BUDDY_ABOUT_VERSION__: JSON.stringify(pkg.version),
  },
  minify: false,
  sourcemap: true,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(pkg.name)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
    footer: '\t\treturn module.exports;\n\t}\n});',
  },
});
