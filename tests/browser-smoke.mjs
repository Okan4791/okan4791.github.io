import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const captureEvidence = process.argv.includes('--capture-evidence');
const mime = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = join(root, normalize(pathname).replace(/^\/+/, ''));
  if (pathname.endsWith('/')) file = join(file, 'index.html');
  if (!existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404, { 'content-type': 'text/html' });
    createReadStream(join(root, '404.html')).pipe(response);
    return;
  }
  response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(4173, '127.0.0.1', done));

const browser = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
if (!browser) throw new Error('Chrome or Chromium is required for the browser smoke test');
const profile = mkdtempSync('/tmp/bolens-site-smoke-');
const chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let browserLog = '';
chrome.stderr.on('data', (chunk) => { browserLog += chunk.toString(); });

async function waitForDebugger() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await fetch('http://127.0.0.1:9222/json/version').then((result) => result.json()); } catch { await new Promise((done) => setTimeout(done, 100)); }
  }
  throw new Error(`browser debugger did not start with ${browser}: ${browserLog.slice(-1200)}`);
}

let socket;
try {
  await waitForDebugger();
  const target = await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' }).then((result) => result.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const handler = pending.get(message.id); pending.delete(message.id);
      return message.error ? handler.reject(message.error) : handler.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text);
    if (message.method === 'Network.loadingFailed' && !message.params.canceled) errors.push(message.params.errorText);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'].map((method) => send(method)));

  const missing = await fetch('http://127.0.0.1:4173/missing-route');
  if (missing.status !== 404 || !(await missing.text()).includes('This signal')) throw new Error('custom 404 response failed');

  for (const width of [390, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 1000, deviceScaleFactor: 1, mobile: width === 390 });
    for (const route of ['/', '/work/', '/about/', '/case-studies/uddns/', '/case-studies/aur-response-toolkit/', '/case-studies/privacy-devices/']) {
      await send('Page.navigate', { url: `http://127.0.0.1:4173${route}` });
      for (let attempt = 0; attempt < 40; attempt++) {
        const state = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        if (state.result.value === 'complete') break;
        await new Promise((done) => setTimeout(done, 50));
      }
      const check = await send('Runtime.evaluate', { expression: `({h1:document.querySelectorAll('h1').length,main:!!document.querySelector('main'),overflow:document.documentElement.scrollWidth>innerWidth,title:document.title})`, returnByValue: true });
      const value = check.result.value;
      if (value.h1 !== 1 || !value.main || value.overflow || !value.title) throw new Error(`${width}px ${route}: ${JSON.stringify(value)}`);
    }
    if (captureEvidence) {
      await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
      await new Promise((done) => setTimeout(done, 200));
      await send('Runtime.evaluate', { expression: `document.documentElement.style.scrollBehavior='auto';document.querySelector('#off-the-clock').scrollIntoView({block:'end'})` });
      await new Promise((done) => setTimeout(done, 200));
      const capture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      writeFileSync(`/tmp/bolens-hobbies-${width}.png`, Buffer.from(capture.data, 'base64'));
    }
  }

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
  await new Promise((done) => setTimeout(done, 150));
  const preferences = await send('Runtime.evaluate', { expression: `({dark:matchMedia('(prefers-color-scheme: dark)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})`, returnByValue: true });
  if (!preferences.result.value.dark || !preferences.result.value.reduced) throw new Error('preference emulation failed');

  await send('Emulation.setEmulatedMedia', { media: 'print', features: [] });
  const print = await send('Runtime.evaluate', { expression: `({print:matchMedia('print').matches,visibility:getComputedStyle(document.querySelector('.work-section')).contentVisibility,animations:document.getAnimations().length})`, returnByValue: true });
  if (!print.result.value.print || print.result.value.visibility !== 'visible' || print.result.value.animations !== 0) throw new Error(`print override failed: ${JSON.stringify(print.result.value)}`);

  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'forced-colors', value: 'active' }] });
  const forced = await send('Runtime.evaluate', { expression: `({active:matchMedia('(forced-colors: active)').matches,button:getComputedStyle(document.querySelector('.button')).forcedColorAdjust,pulse:getComputedStyle(document.querySelector('.map-node .pulse')).display})`, returnByValue: true });
  if (!forced.result.value.active || forced.result.value.button !== 'none' || forced.result.value.pulse !== 'none') throw new Error(`forced-colors override failed: ${JSON.stringify(forced.result.value)}`);
  if (errors.length) throw new Error(`browser errors: ${errors.join('; ')}`);
  console.log('Browser smoke passed 12 responsive route renders, custom 404, dark mode, reduced motion, print, and forced colors with no page, console, or network errors.');
} finally {
  socket?.close(); chrome.kill('SIGTERM'); server.close();
}
