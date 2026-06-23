// Bakes the served Studio's config at build time by substituting the %%KEY%%
// placeholders in the built studio index.html from env (same mechanism as
// Mastra's documented standalone-SPA Vite plugin). Run AFTER `mastra build --studio`.
//
// Default MASTRA_AUTO_DETECT_URL=true → Studio connects to the SAME ORIGIN it's
// served from, so this works for ANY deploy domain with no per-deploy config
// (no "enter your Mastra instance URL" form). Override any value via env.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = '.mastra/output/studio/index.html';
if (!existsSync(file)) {
  console.error(`[bake-studio] ${file} not found — did "mastra build --studio" run?`);
  process.exit(1);
}

const defaults = {
  MASTRA_AUTO_DETECT_URL: 'true',
  MASTRA_API_PREFIX: '/api',
  MASTRA_TELEMETRY_DISABLED: 'true',
  MASTRA_HIDE_CLOUD_CTA: 'false',
  MASTRA_TEMPLATES: 'false',
  MASTRA_EXPERIMENTAL_FEATURES: 'false',
  MASTRA_EXPERIMENTAL_UI: 'false',
  MASTRA_THEME_TOGGLE: 'false',
  MASTRA_STUDIO_BASE_PATH: '',
  MASTRA_CLOUD_API_ENDPOINT: '',
  MASTRA_REQUEST_CONTEXT_PRESETS: '',
  MASTRA_AGENT_SIGNALS: '',
  MASTRA_SERVER_HOST: '',
  MASTRA_SERVER_PORT: '',
  MASTRA_SERVER_PROTOCOL: '',
};

let html = readFileSync(file, 'utf8');
html = html.replaceAll(/%%(\w+)%%/g, (_, key) => process.env[key] ?? defaults[key] ?? '');
writeFileSync(file, html);
console.log('[bake-studio] substituted Studio placeholders (auto-detect URL = same origin)');
