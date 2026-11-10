/**
 * Renders assets/logo/*.svg into every Android launcher/splash size and the web favicon.
 * Uses Playwright's Chromium (already a dev dependency), so no image tools are needed.
 *
 *   node scripts/generate-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'android/app/src/main/res');
const background = readFileSync(join(root, 'assets/logo/background-color.txt'), 'utf8').trim();

/** The SVG as a nested <svg> element covering the 108-unit canvas (so it can be placed and cropped). */
const nested = (file) =>
  readFileSync(join(root, 'assets/logo', file), 'utf8').replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">', '<svg x="0" y="0" width="108" height="108" viewBox="0 0 108 108">');
const foreground = nested('foreground.svg');
const monochrome = nested('monochrome.svg');

// Density buckets: adaptive layers are 108dp, legacy icons 48dp.
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svg, width, height, out) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

const svgDoc = (w, h, viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" style="display:block">${body}</svg>`;

for (const [bucket, scale] of Object.entries(densities)) {
  const dir = join(res, `mipmap-${bucket}`);
  const layer = Math.round(108 * scale);
  const legacy = Math.round(48 * scale);
  // Adaptive icon layers (API 26+). The system adds the background colour and the mask.
  await render(svgDoc(layer, layer, '0 0 108 108', foreground), layer, layer, join(dir, 'ic_launcher_foreground.png'));
  await render(svgDoc(layer, layer, '0 0 108 108', monochrome), layer, layer, join(dir, 'ic_launcher_monochrome.png'));
  // Legacy icons (API 24–25): the central 72 units on the background, pre-masked.
  const crop = '18 18 72 72';
  await render(svgDoc(legacy, legacy, crop, `<rect x="18" y="18" width="72" height="72" rx="14" fill="${background}"/>${foreground}`), legacy, legacy, join(dir, 'ic_launcher.png'));
  await render(svgDoc(legacy, legacy, crop, `<circle cx="54" cy="54" r="36" fill="${background}"/>${foreground}`), legacy, legacy, join(dir, 'ic_launcher_round.png'));
}

// Splash images (pre-Android 12 launch background): logo centred on the background colour.
const splashes = {
  drawable: [480, 320],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(splashes)) {
  // Show the 72-unit art area at 40% of the shorter side, centred.
  const units = 72 / 0.4;
  const vw = (units * w) / Math.min(w, h);
  const vh = (units * h) / Math.min(w, h);
  const viewBox = `${54 - vw / 2} ${54 - vh / 2} ${vw} ${vh}`;
  const body = `<rect x="-2000" y="-2000" width="4000" height="4000" fill="${background}"/>${foreground}`;
  await render(svgDoc(w, h, viewBox, body), w, h, join(res, dir, 'splash.png'));
}

// Web favicon (dev server / PWA): full icon as SVG.
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public/favicon.svg'), svgDoc(108, 108, '18 18 72 72', `<rect x="18" y="18" width="72" height="72" rx="16" fill="${background}"/>${foreground}`).replace(' style="display:block"', ''));

await browser.close();
console.log('Icons written.');
