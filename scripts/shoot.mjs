/**
 * Dev harness: drive the real app in headless Chrome over the DevTools
 * protocol, capture a screenshot, and fail if anything landed in the console.
 * Zero dependencies — Node's built-in WebSocket does the talking.
 *
 *   node scripts/shoot.mjs --out scripts/out/tank.png --w 1280 --h 800 \
 *        [--seed scripts/seed.json] [--after "js"] [--wait 2500]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const url = opt('url', 'http://localhost:5180/');
const out = opt('out', 'scripts/out/shot.png');
const width = Number(opt('w', 1280));
const height = Number(opt('h', 800));
const dpr = Number(opt('dpr', 2));
const waitMs = Number(opt('wait', 2500));
const seedFile = opt('seed', null);
const after = opt('after', null);
const mobile = args.includes('--mobile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--user-data-dir=/tmp/pa-chrome-profile',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let nextId = 1;
const waiters = new Map();
const events = [];
const problems = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    setTimeout(() => {
      if (waiters.has(id)) {
        waiters.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 20000);
  });
}

function onceEvent(name, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${name}`)), timeout);
    events.push({ name, resolve, clear: () => clearTimeout(t) });
  });
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, {
        method: 'PUT',
      });
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

const wsUrl = await connect();
ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));

ws.onmessage = (raw) => {
  const msg = JSON.parse(raw.data);
  if (msg.id && waiters.has(msg.id)) {
    const w = waiters.get(msg.id);
    waiters.delete(msg.id);
    if (msg.error) w.reject(new Error(JSON.stringify(msg.error)));
    else w.resolve(msg.result);
    return;
  }
  // Console noise and uncaught errors are treated as build failures.
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    problems.push(
      `console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`
    );
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    problems.push(`uncaught: ${d.exception?.description || d.text}`);
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    const text = msg.params.entry.text || '';
    // Font CDN blocked in a sandbox is not the app's fault.
    if (!/fonts\.(googleapis|gstatic)/.test(text)) problems.push(`log: ${text}`);
  }
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].name === msg.method) {
      events[i].clear();
      events[i].resolve(msg.params);
      events.splice(i, 1);
    }
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: dpr,
  mobile,
});

// --fresh wipes storage before the document runs, for first-visit testing. The
// Chrome profile is reused between runs, so without this a previous run's save
// leaks into the next one.
if (args.includes('--fresh')) {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try { localStorage.clear(); } catch (e) {}',
  });
}

// Seeding runs as a pre-document script rather than "write then reload": the
// app saves on pagehide, so a reload would overwrite the seed with whatever the
// outgoing page had. This lands the save before any of the app's code runs.
if (seedFile) {
  const seed = readFileSync(seedFile, 'utf8');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('pixel-aquarium/save', ${JSON.stringify(
      seed
    )}); } catch (e) {}`,
  });
}

{
  const loaded = onceEvent('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
}

await sleep(waitMs);

if (after) {
  const r = await send('Runtime.evaluate', { expression: after, awaitPromise: true });
  if (r.exceptionDetails) problems.push(`after: ${r.exceptionDetails.text}`);
  await sleep(Number(opt('wait2', 1200)));
}

// --clicks "x,y;x,y" dispatches genuine input events, so canvas pointer
// handling is exercised the way a player would exercise it.
const clicks = opt('clicks', null);
if (clicks) {
  for (const pair of clicks.split(';')) {
    const [x, y] = pair.split(',').map(Number);
    const base = { x, y, clickCount: 1, pointerType: 'mouse' };
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', buttons: 0 });
    await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button: 'left', buttons: 1 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button: 'left', buttons: 0 });
    await sleep(220);
  }
  await sleep(Number(opt('wait3', 700)));
}

// --dragrel "selector;fx,fy;fx,fy;..." presses at the first point and drags
// through the rest, with coordinates given as fractions of the element's box so
// the test doesn't break when the layout moves.
const dragrel = opt('dragrel', null);
if (dragrel) {
  const [selector, ...points] = dragrel.split(';');
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const e = document.querySelector('${selector}');
      if (!e) return null; const b = e.getBoundingClientRect();
      return {x: b.left, y: b.top, w: b.width, h: b.height}; })()`,
    returnByValue: true,
  });
  const box = r.result?.value;
  if (!box) {
    problems.push(`dragrel: no element ${selector}`);
  } else {
    const pts = points.map((p) => {
      const [fx, fy] = p.split(',').map(Number);
      return { x: Math.round(box.x + fx * box.w), y: Math.round(box.y + fy * box.h) };
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      buttons: 1,
      clickCount: 1,
      ...pts[0],
    });
    for (const p of pts.slice(1)) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        button: 'left',
        buttons: 1,
        ...p,
      });
      await sleep(40);
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      buttons: 0,
      clickCount: 1,
      ...pts[pts.length - 1],
    });
    await sleep(300);
  }
}

// --keys "Tab;ArrowRight;Enter;b" dispatches real key events. Named keys need
// their virtual key codes or Chrome won't route them to the page.
const VK = {
  Tab: 9,
  Enter: 13,
  Escape: 27,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Backspace: 8,
  Delete: 46,
  ' ': 32,
};
const keys = opt('keys', null);
if (keys) {
  for (const raw of keys.split(';')) {
    const k = raw === 'Space' ? ' ' : raw;
    const named = VK[k] !== undefined;
    const base = {
      key: k,
      code: named ? (k === ' ' ? 'Space' : k) : `Key${k.toUpperCase()}`,
      windowsVirtualKeyCode: named ? VK[k] : k.toUpperCase().charCodeAt(0),
      nativeVirtualKeyCode: named ? VK[k] : k.toUpperCase().charCodeAt(0),
    };
    await send('Input.dispatchKeyEvent', {
      ...base,
      type: named && k !== ' ' ? 'rawKeyDown' : 'keyDown',
      text: named && k !== ' ' ? undefined : k,
    });
    await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    await sleep(120);
  }
  await sleep(400);
}

// --touchrel "selector;fx,fy;..." taps (one point) or drags (several) with real
// touch events, so the touch path is verified rather than assumed.
const touchrel = opt('touchrel', null);
if (touchrel) {
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const [selector, ...points] = touchrel.split(';');
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const e = document.querySelector('${selector}');
      if (!e) return null; const b = e.getBoundingClientRect();
      return {x: b.left, y: b.top, w: b.width, h: b.height}; })()`,
    returnByValue: true,
  });
  const box = r.result?.value;
  if (!box) {
    problems.push(`touchrel: no element ${selector}`);
  } else {
    const pts = points.map((p) => {
      const [fx, fy] = p.split(',').map(Number);
      return { x: Math.round(box.x + fx * box.w), y: Math.round(box.y + fy * box.h) };
    });
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...pts[0], id: 1 }],
    });
    for (const p of pts.slice(1)) {
      await send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...p, id: 1 }],
      });
      await sleep(60);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
  }
}

async function elementBox(selector) {
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const e = document.querySelector('${selector}');
      if (!e) return null; const b = e.getBoundingClientRect();
      return {x: b.left, y: b.top, w: b.width, h: b.height}; })()`,
    returnByValue: true,
  });
  return r.result?.value || null;
}

// --clickrel "selector;fx,fy;fx,fy" clicks at fractions of an element's box.
const clickrel = opt('clickrel', null);
if (clickrel) {
  const [selector, ...points] = clickrel.split(';');
  const box = await elementBox(selector);
  if (!box) problems.push(`clickrel: no element ${selector}`);
  else {
    for (const p of points) {
      const [fx, fy] = p.split(',').map(Number);
      const at = {
        x: Math.round(box.x + fx * box.w),
        y: Math.round(box.y + fy * box.h),
        clickCount: 1,
      };
      await send('Input.dispatchMouseEvent', { ...at, type: 'mouseMoved', button: 'none', buttons: 0 });
      await send('Input.dispatchMouseEvent', { ...at, type: 'mousePressed', button: 'left', buttons: 1 });
      await sleep(60);
      await send('Input.dispatchMouseEvent', { ...at, type: 'mouseReleased', button: 'left', buttons: 0 });
      await sleep(250);
    }
  }
}

// --then "<js>" runs after all input, for asserting on post-interaction state.
const then = opt('then', null);
if (then) {
  const r = await send('Runtime.evaluate', { expression: then, awaitPromise: true });
  if (r.exceptionDetails) problems.push(`then: ${r.exceptionDetails.text}`);
  await sleep(Number(opt('wait4', 1400)));
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));

// --probe "<js>" prints a value from the live page, for asserting on state that
// a screenshot can't show.
const probe = opt('probe', null);
if (probe) {
  const r = await send('Runtime.evaluate', {
    expression: probe,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) problems.push(`probe: ${r.exceptionDetails.text}`);
  else console.log(`probe: ${JSON.stringify(r.result.value)}`);
}

ws.close();
chrome.kill();

console.log(`shot -> ${out}  (${width}x${height} @${dpr}x)`);
if (problems.length) {
  console.error('\nconsole problems:');
  for (const p of [...new Set(problems)]) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('console clean');
