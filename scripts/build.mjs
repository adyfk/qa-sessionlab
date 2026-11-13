import { build as esbuild, context } from 'esbuild';
import { build as viteBuild } from 'vite';
import preact from '@preact/preset-vite';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeIcons } from './icons.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const scripts = [
  { entryPoints: [resolve(root, 'src/background/index.ts')], outfile: resolve(out, 'background.js'), format: 'esm' },
  // Content scripts cannot be ES modules.
  { entryPoints: [resolve(root, 'src/content/isolated.ts')], outfile: resolve(out, 'content.js'), format: 'iife' },
  { entryPoints: [resolve(root, 'src/content/main.ts')], outfile: resolve(out, 'main.js'), format: 'iife' },
].map((o) => ({
  ...o, bundle: true, target: 'chrome116', sourcemap: watch ? 'inline' : false, minify: false, logLevel: 'info',
  // keepNames would wrap functions in __name() helpers that break the serialized MAIN-world shim.
  keepNames: false,
}));

const ui = {
  configFile: false,
  root: resolve(root, 'src/ui'),
  base: './',
  plugins: [preact()],
  logLevel: 'warn',
  build: {
    outDir: out, emptyOutDir: false, target: 'chrome116', sourcemap: watch ? 'inline' : false,
    rollupOptions: { input: { popup: resolve(root, 'src/ui/popup.html'), sidepanel: resolve(root, 'src/ui/sidepanel.html'), welcome: resolve(root, 'src/ui/welcome.html') } },
    watch: watch ? {} : null,
  },
};

await cp(resolve(root, 'src/manifest.json'), resolve(out, 'manifest.json'));
await cp(resolve(root, 'src/_locales'), resolve(out, '_locales'), { recursive: true });
await writeIcons(resolve(out, 'icons'));

if (watch) {
  for (const s of scripts) await (await context(s)).watch();
  await viteBuild(ui);
  console.log('watching… load dist/ as an unpacked extension');
} else {
  await Promise.all(scripts.map((s) => esbuild(s)));
  await viteBuild(ui);
  console.log('built → dist/');
}
