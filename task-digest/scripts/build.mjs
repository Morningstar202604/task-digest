import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(src, 'server.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(dist, 'server.mjs'),
  external: ['node:sqlite', 'node:fs', 'node:path', 'node:os', 'node:module', 'node:url', 'node:buffer', 'node:stream', 'node:events', 'node:crypto', 'node:tty', 'node:util', 'node:async_hooks', 'node:net', 'node:http', 'node:https', 'node:zlib', 'node:process', 'node:string_decoder'],
  banner: { js: "import{createRequire as __tdRequire}from'node:module';const require=__tdRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'error',
});

const panelBundle = await build({
  entryPoints: [path.join(src, 'panel.js')],
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  write: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'error',
});

const js = panelBundle.outputFiles[0].text;
const css = fs.readFileSync(path.join(src, 'panel.css'), 'utf8');
const tpl = fs.readFileSync(path.join(src, 'panel.tpl.html'), 'utf8');
const html = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(dist, 'panel.html'), html, 'utf8');

const srvSize = fs.statSync(path.join(dist, 'server.mjs')).size;
console.log('server.mjs', (srvSize / 1024).toFixed(0) + ' KB');
console.log('panel.html', (html.length / 1024).toFixed(0) + ' KB');
