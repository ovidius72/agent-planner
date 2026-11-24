#!/usr/bin/env node
// Export the Agent Brain UI mockup (docs/agent-brain-ui/mockup/*.dc.html) to plain,
// self-contained HTML pages with the demo data already rendered.
//
// The .dc.html files are Design Component templates: {{holes}}, <sc-if>/<sc-for>
// and the page logic only resolve when the design-canvas runtime (support.js) is
// loaded. Opened directly (or imported into another tool) they show the raw
// template, and links between pages do nothing. This script renders every page
// through the runtime in headless Chromium and saves the resulting DOM to
// docs/agent-brain-ui/mockup/static/, rewriting X.dc.html links to X.html.
//
// Usage:
//   node scripts/export-mockup-static.mjs --runtime <path/to/dc-runtime.js>
// The runtime is the artifact's `artifact-type/dc-runtime.js` (see
// docs/agent-brain-ui/ARTIFACT.md). It is not committed to the repo.

import { createServer } from 'node:http';
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mockupDir = join(root, 'docs/agent-brain-ui/mockup');
const outDir = join(mockupDir, 'static');

const argv = process.argv.slice(2);
const runtimeArg = argv[argv.indexOf('--runtime') + 1];
const runtimePath = argv.includes('--runtime') && runtimeArg
  ? resolve(runtimeArg)
  : join(mockupDir, 'support.js');
if (!existsSync(runtimePath)) {
  console.error(`Runtime not found: ${runtimePath}\nPass --runtime <path/to/dc-runtime.js>.`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path === '/support.js' ? runtimePath : join(mockupDir, path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const pages = (await readdir(mockupDir)).filter((f) => f.endsWith('.dc.html')).sort();
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const failures = [];
for (const file of pages) {
  const page = await browser.newPage({ viewport: { width: 1320, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/${file}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const { html, holes } = await page.evaluate(() => {
    document.querySelectorAll('script').forEach((s) => s.remove());
    const text = document.body.innerText;
    const holes = (text.match(/\{\{[^}]+\}\}/g) || []).length;
    return { html: '<!doctype html>\n' + document.documentElement.outerHTML, holes };
  });
  await page.close();
  if (holes || errors.length) failures.push(`${file}: ${holes} unresolved holes ${errors.join('; ')}`);
  const out = html
    .replace(/href="([A-Za-z0-9_-]+)\.dc\.html/g, 'href="$1.html')
    .replace('</head>', `<meta name="generator" content="scripts/export-mockup-static.mjs">\n</head>`);
  await writeFile(join(outDir, file.replace('.dc.html', '.html')), out);
  console.log(`✓ ${file}`);
}
await browser.close();
server.close();

const items = pages.map((f) => {
  const name = f.replace('.dc.html', '');
  return `<li><a href="${name}.html">${name}</a></li>`;
}).join('\n');
await writeFile(join(outDir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Plan mockup</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#0f172a}a{color:#4f46e5}</style>
</head><body>
<h1>Agent Plan — mockup (static export)</h1>
<p>Rendered from <code>../*.dc.html</code> with the demo data resolved. Links between screens work;
in-page toggles (modals, filters, theme) need the interactive canvas — see <code>ARTIFACT.md</code>.</p>
<p><a href="Main.html"><b>Open the Planner →</b></a></p>
<ul>
${items}
</ul>
</body></html>
`);

if (failures.length) {
  console.error('Problems:\n' + failures.join('\n'));
  process.exit(1);
}
