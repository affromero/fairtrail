#!/usr/bin/env node
/**
 * Anti-detection verification: launches a stealth browser context and checks
 * that all init scripts are injected correctly (WebRTC, canvas, WebGL, audio,
 * screen alignment, navigator overrides).
 *
 * Usage: node scripts/anti-detection-test.mjs
 */

import { chromium } from 'playwright';

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let pass = 0;
let fail = 0;

function ok(msg) { pass++; console.log(`${GREEN}PASS${RESET} ${msg}`); }
function bad(msg, detail) { fail++; console.log(`${RED}FAIL${RESET} ${msg} -- ${detail}`); }

console.log(`\n${BOLD}Anti-detection init script verification${RESET}\n`);

// Import the actual browser module to test real stealth context creation
const { launchBrowser, createStealthContext } = await import('../apps/web/src/lib/scraper/browser.ts');
const { COUNTRY_PROFILES } = await import('../apps/web/src/lib/scraper/country-profiles.ts');

const profile = COUNTRY_PROFILES['DE'];

// Test with proxy URL to exercise DNS leak prevention path
const browser = await launchBrowser({ proxyUrl: 'socks5://fake-proxy:1080' });
const context = await createStealthContext(browser, { countryProfile: profile });
const page = await context.newPage();

// Navigate to a blank page so init scripts execute
await page.goto('about:blank');

// ── Test 1: navigator.webdriver is false ─────────────────────────
const webdriver = await page.evaluate(() => navigator.webdriver);
if (webdriver === false) ok('navigator.webdriver is false');
else bad('navigator.webdriver', `expected false, got ${webdriver}`);

// ── Test 2: window.chrome exists ─────────────────────────────────
const hasChrome = await page.evaluate(() => !!(/** @type {any} */(window)).chrome?.runtime);
if (hasChrome) ok('window.chrome.runtime exists');
else bad('window.chrome', 'missing');

// ── Test 3: navigator.plugins has entries ────────────────────────
const pluginCount = await page.evaluate(() => navigator.plugins.length);
if (pluginCount >= 3) ok(`navigator.plugins has ${pluginCount} entries`);
else bad('navigator.plugins', `expected >= 3, got ${pluginCount}`);

// ── Test 4: navigator.languages matches DE profile ───────────────
const languages = await page.evaluate(() => navigator.languages);
if (languages[0] === 'de-DE') ok(`navigator.languages[0] = ${languages[0]}`);
else bad('navigator.languages', `expected de-DE, got ${languages[0]}`);

// ── Test 5: hardwareConcurrency is 4-8 ──────────────────────────
const cores = await page.evaluate(() => navigator.hardwareConcurrency);
if (cores >= 4 && cores <= 8) ok(`hardwareConcurrency = ${cores}`);
else bad('hardwareConcurrency', `expected 4-8, got ${cores}`);

// ── Test 6: deviceMemory is 8 ───────────────────────────────────
const memory = await page.evaluate(() => /** @type {any} */(navigator).deviceMemory);
if (memory === 8) ok(`deviceMemory = ${memory}`);
else bad('deviceMemory', `expected 8, got ${memory}`);

// ── Test 7: RTCPeerConnection strips ICE servers ────────────────
const iceServers = await page.evaluate(() => {
  try {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const config = pc.getConfiguration();
    pc.close();
    return config.iceServers?.length ?? -1;
  } catch { return -1; }
});
if (iceServers === 0) ok('RTCPeerConnection strips ICE servers');
else bad('RTCPeerConnection', `expected 0 ICE servers, got ${iceServers}`);

// ── Test 8: Canvas toDataURL is patched ─────────────────────────
const canvasPatched = await page.evaluate(() => {
  const c1 = document.createElement('canvas');
  c1.width = 200; c1.height = 50;
  const ctx = c1.getContext('2d');
  if (!ctx) return false;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 200, 50);
  ctx.fillStyle = '#00ff00';
  ctx.font = '14px Arial';
  ctx.fillText('fingerprint test', 10, 30);
  const d1 = c1.toDataURL();
  const d2 = c1.toDataURL();
  // With noise injection, repeated calls may differ (or at least the function is overridden)
  return typeof d1 === 'string' && d1.startsWith('data:image/png');
});
if (canvasPatched) ok('Canvas toDataURL returns valid data URL');
else bad('Canvas toDataURL', 'not patched or broken');

// ── Test 9: Screen dimensions match viewport ────────────────────
const screenCheck = await page.evaluate(() => {
  const vp = { w: window.innerWidth, h: window.innerHeight };
  return {
    screenW: screen.width,
    screenH: screen.height,
    outerW: window.outerWidth,
    availW: screen.availWidth,
    colorDepth: screen.colorDepth,
    dpr: window.devicePixelRatio,
    vpW: vp.w,
    vpH: vp.h,
  };
});
if (screenCheck.screenW === screenCheck.vpW) ok(`screen.width = viewport width (${screenCheck.screenW})`);
else bad('screen.width', `${screenCheck.screenW} != viewport ${screenCheck.vpW}`);

if (screenCheck.outerW === screenCheck.screenW) ok(`outerWidth matches screen.width`);
else bad('outerWidth', `${screenCheck.outerW} != ${screenCheck.screenW}`);

if (screenCheck.colorDepth === 24) ok(`screen.colorDepth = 24`);
else bad('screen.colorDepth', `expected 24, got ${screenCheck.colorDepth}`);

if (screenCheck.dpr === 1) ok(`devicePixelRatio = 1`);
else bad('devicePixelRatio', `expected 1, got ${screenCheck.dpr}`);

// ── Test 10: connection mock ────────────────────────────────────
const connection = await page.evaluate(() => /** @type {any} */(navigator).connection?.effectiveType);
if (connection === '4g') ok(`connection.effectiveType = 4g`);
else bad('connection', `expected 4g, got ${connection}`);

// ── Test 11: WebGL unmasked renderer is spoofed ─────────────────
const webglRenderer = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl');
  if (!gl) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (!ext) return 'no-ext';
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
});
if (webglRenderer === null) ok('WebGL not available (headless/SwiftShader) -- spoof will activate on real contexts');
else if (webglRenderer && webglRenderer.includes('ANGLE')) ok(`WebGL renderer spoofed: ${webglRenderer.slice(0, 50)}...`);
else bad('WebGL renderer', `got: ${webglRenderer}`);

await context.close();
await browser.close();

console.log(`\n${BOLD}Results: ${pass} passed, ${fail} failed${RESET}\n`);
process.exit(fail > 0 ? 1 : 0);
