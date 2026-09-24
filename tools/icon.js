// Erzeugt die App-Symbole in icons/ aus tools/icon.svg.
// Aufruf: node tools/icon.js   (braucht Playwright mit Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
const SIZES = [
  ['apple-touch-icon-180.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
  });
  for (const [name, size] of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${SVG}`);
    await page.screenshot({ path: path.join(ROOT, 'icons', name) });
    await page.close();
    console.log('geschrieben:', name);
  }
  await browser.close();
})();
