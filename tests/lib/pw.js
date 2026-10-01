// Playwright ohne npm install: das global installierte Paket (NODE_PATH, /opt/node22 …) oder
// ein Pfad aus PLAYWRIGHT_PATH. Chromium kommt aus PW_CHROMIUM (Standard: /opt/pw-browsers/…);
// fehlt die Datei, nimmt Playwright seinen eigenen Browser. Nie „playwright install“.
'use strict';
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  const tries = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    ...String(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean).map((p) => path.join(p, 'playwright')),
    '/opt/node22/lib/node_modules/playwright',
    '/usr/local/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright',
  ].filter(Boolean);
  for (const t of tries) {
    try { return require(t); } catch (_) { /* nächster Versuch */ }
  }
  throw new Error('Playwright nicht gefunden. Global installieren oder PLAYWRIGHT_PATH setzen.');
}

const CHROMIUM = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function launch() {
  const { chromium } = loadPlaywright();
  return chromium.launch({
    executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
}

module.exports = { loadPlaywright, launch, CHROMIUM };
