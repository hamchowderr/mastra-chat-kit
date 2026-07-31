/**
 * Render README.md to a styled HTML preview (readme-preview.html at the repo root, so the
 * relative docs/*.png images resolve) for local review. Not part of the app; delete freely.
 *   node scripts/readme-preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from '../node_modules/.pnpm/marked@16.4.2/node_modules/marked/lib/marked.esm.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(path.join(root, 'README.md'), 'utf8');
const body = marked.parse(md, { gfm: true, breaks: false });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>README preview — mastra-chat-kit</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #f6f8fa; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; } .md { background:#0d1117; color:#e6edf3; border-color:#30363d; } .md code { background:#161b22; } .md pre { background:#161b22; } .md th,.md td { border-color:#30363d; } .md h1,.md h2 { border-color:#21262d; } .md a { color:#4493f8; } .md blockquote { color:#8b949e; border-color:#30363d; } }
  .md { max-width: 900px; margin: 32px auto; padding: 40px; background:#fff; color:#1f2328;
        border:1px solid #d0d7de; border-radius:12px;
        font: 16px/1.6 -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
  .md h1 { font-size: 2em; border-bottom:1px solid #d0d7de; padding-bottom:.3em; }
  .md h2 { font-size: 1.5em; border-bottom:1px solid #d0d7de; padding-bottom:.3em; margin-top:1.5em; }
  .md h3 { font-size: 1.15em; }
  .md code { background:#eff1f3; padding:.2em .4em; border-radius:6px; font-size:85%;
             font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  .md pre { background:#f6f8fa; padding:16px; border-radius:8px; overflow:auto; }
  .md pre code { background:none; padding:0; }
  .md table { border-collapse:collapse; display:block; overflow:auto; width:max-content; max-width:100%; }
  .md th, .md td { border:1px solid #d0d7de; padding:6px 13px; }
  .md tr:nth-child(2n) { background:#f6f8fa; }
  .md img { max-width:100%; border:1px solid #d0d7de; border-radius:8px; }
  .md a { color:#0969da; text-decoration:none; } .md a:hover { text-decoration:underline; }
  .md blockquote { color:#59636e; border-left:.25em solid #d0d7de; padding:0 1em; margin:0; }
  .md div[align="center"] { text-align:center; }
</style></head>
<body><article class="md">${body}</article></body></html>`;

const out = path.join(root, 'readme-preview.html');
writeFileSync(out, html);
console.log(out);
