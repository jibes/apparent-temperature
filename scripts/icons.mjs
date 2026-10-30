// Rasterises public/icon.svg into the PNG icons the PWA manifest and the
// Android launcher need. Run after changing the SVG: `npm run icons`.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icon.svg', 'utf8');

// [output path, size, inner scale, background] — the maskable icon keeps the
// art inside the 80 % safe zone on a full-bleed background.
const targets = [
  ['public/icons/192.png', 192, 1, 'transparent'],
  ['public/icons/512.png', 512, 1, 'transparent'],
  ['public/icons/maskable-512.png', 512, 0.8, '#0d0f18'],
];
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, px] of Object.entries(densities)) {
  const res = `android/app/src/main/res/mipmap-${d}`;
  targets.push([`${res}/ic_launcher.png`, px, 1, 'transparent']);
  targets.push([`${res}/ic_launcher_round.png`, px, 1, 'transparent']);
  // Adaptive-icon foreground: 108 dp canvas, art inside the 66 dp safe zone
  // (the background layer is the app colour, see ic_launcher_background).
  targets.push([`${res}/ic_launcher_foreground.png`, Math.round(px * 2.25), 0.6, 'transparent']);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
for (const [out, size, scale, bg] of targets) {
  const inner = Math.round(size * scale);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg', `<svg width="${inner}" height="${inner}"`)}</div>` +
      `</body></html>`,
  );
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: bg === 'transparent' });
  console.log(out);
}
await browser.close();
