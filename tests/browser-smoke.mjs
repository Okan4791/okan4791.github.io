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
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { return await fetch('http://127.0.0.1:9222/json/version').then((result) => result.json()); } catch { await new Promise((done) => setTimeout(done, 100)); }
  }
  throw new Error(`browser debugger did not start within 20s with ${browser}: ${browserLog.slice(-1200)}`);
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
  const capturePhase = async (width, name, selector, time) => {
    await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
    await new Promise((done) => setTimeout(done, 200));
    await send('Runtime.evaluate', { expression: `
      document.documentElement.style.scrollBehavior='auto';
      const target=document.querySelector(${JSON.stringify(selector)});
      const box=target.getBoundingClientRect();
      window.scrollTo(0,box.top+scrollY-(innerHeight-box.height)/2);
    ` });
    await new Promise((done) => setTimeout(done, 100));
    await send('Runtime.evaluate', { expression: `
      const target=document.querySelector(${JSON.stringify(selector)});
      document.getAnimations().filter((animation)=>target.contains(animation.effect?.target)).forEach((animation)=>{try{animation.pause();animation.currentTime=${time}}catch{}});
      target.querySelectorAll('svg').forEach((svg)=>{svg.pauseAnimations?.();svg.setCurrentTime?.(${time / 1000})});
    ` });
    await new Promise((done) => setTimeout(done, 100));
    const capture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(`/tmp/bolens-${name}-${width}-${time}.png`, Buffer.from(capture.data, 'base64'));
  };
  const captureSequence = async (width, name, selector, times) => {
    await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
    await new Promise((done) => setTimeout(done, 200));
    await send('Runtime.evaluate', { expression: `
      document.documentElement.style.scrollBehavior='auto';
      const target=document.querySelector(${JSON.stringify(selector)});
      const box=target.getBoundingClientRect();
      window.scrollTo(0,box.top+scrollY-(innerHeight-box.height)/2);
    ` });
    await new Promise((done) => setTimeout(done, 100));
    await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)}).querySelectorAll('svg').forEach((svg)=>svg.unpauseAnimations?.())` });
    const started = Date.now();
    for (const time of times) {
      const remaining = time - (Date.now() - started);
      if (remaining > 0) await new Promise((done) => setTimeout(done, remaining));
      const capture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      writeFileSync(`/tmp/bolens-${name}-${width}-${time}.png`, Buffer.from(capture.data, 'base64'));
    }
  };
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
      await captureSequence(width, 'hobbies', '#off-the-clock', [0, 400, 800, 1600, 2600, 4800, 6200, 7000, 10000, 12000, 14000, 16000, 19000, 22000]);
      await capturePhase(width, 'uddns', '.visual-ddns', 0);
      await capturePhase(width, 'uddns', '.visual-ddns', 1800);
    }
  }

  await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
  await new Promise((done) => setTimeout(done, 200));
  const motion = await send('Runtime.evaluate', { expression: `(()=>{
    const ddns=document.querySelector('.visual-ddns svg');
    const packet=document.querySelector('.ddns-packets circle');
    ddns.setCurrentTime(0);const packetStart=packet.getBoundingClientRect();
    ddns.setCurrentTime(1.8);const packetEnd=packet.getBoundingClientRect();
    const wheel=document.querySelector('.bike-wheel-rear');
    const frame=wheel.previousElementSibling;
    const animation=wheel.getAnimations()[0];animation.pause();animation.currentTime=0;
    const wheelStart=getComputedStyle(wheel).rotate;
    animation.currentTime=1600;const wheelEnd=getComputedStyle(wheel).rotate;
    const hobby=document.querySelector('.hobby-flight-layer');const discForm=document.querySelector('.traveler-disc');const ufoForm=document.querySelector('.traveler-ufo');
    const center=(box)=>({x:box.x+box.width/2,y:box.y+box.height/2});
    hobby.setCurrentTime(0);const discStart=center(discForm.getBoundingClientRect());
    hobby.setCurrentTime(14);const discMiddle=center(discForm.getBoundingClientRect());
    hobby.setCurrentTime(20.2);const discEnd=center(discForm.getBoundingClientRect());
    const basket=center(document.querySelector('.disc-basket-rim').getBoundingClientRect());
    for(const form of [discForm,ufoForm]){const formAnimation=form.getAnimations()[0];formAnimation.pause();formAnimation.currentTime=2600}
    const discOpacity=Number(getComputedStyle(discForm).opacity);const ufoOpacity=Number(getComputedStyle(ufoForm).opacity);
    const tapForm=document.querySelector('.beer-tap');const tapAnimation=tapForm.getAnimations()[0];tapAnimation.pause();tapAnimation.currentTime=14000;
    const bigfoot=document.querySelector('.camp-bigfoot');const bigfootAnimation=bigfoot.getAnimations()[0];bigfootAnimation.pause();bigfootAnimation.currentTime=4800;
    const rider=document.querySelector('.bike-bigfoot-rider');const riderAnimation=rider.getAnimations()[0];riderAnimation.pause();riderAnimation.currentTime=7000;
    const droppedBigfoot=document.querySelector('.ufo-bigfoot');const dropAnimation=droppedBigfoot.getAnimations()[0];dropAnimation.pause();dropAnimation.currentTime=6200;
    const arm=document.querySelector('.throwing-arm');const armAnimation=arm.getAnimations()[0];armAnimation.pause();armAnimation.currentTime=0;const armStart=getComputedStyle(arm).rotate;armAnimation.currentTime=800;const armEnd=getComputedStyle(arm).rotate;
    const labels=[...document.querySelectorAll('.hobby-route li span')].map((label)=>label.textContent);
    const dimensions=(element)=>{const box=element.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height,fill:getComputedStyle(element).fill,stroke:getComputedStyle(element).stroke}};
    return {packetTravel:Math.hypot(packetEnd.x-packetStart.x,packetEnd.y-packetStart.y),discTravel:Math.hypot(discMiddle.x-discStart.x,discMiddle.y-discStart.y),discReturn:discEnd.x<discMiddle.x,landingError:Math.hypot(discEnd.x-basket.x,discEnd.y-basket.y),discOpacity,ufoOpacity,tapOpacity:Number(getComputedStyle(tapForm).opacity),riderOpacity:Number(getComputedStyle(rider).opacity),dropOpacity:Number(getComputedStyle(droppedBigfoot).opacity),bigfootTranslate:getComputedStyle(bigfoot).translate,armStart,armEnd,wheelStart,wheelEnd,frame:getComputedStyle(frame).transform,ufoShell:dimensions(document.querySelector('.ufo-shell')),ufoBeam:dimensions(document.querySelector('.ufo-beam')),tap:dimensions(tapForm),rider:dimensions(rider),labels};
  })()`, returnByValue: true });
  const motionValue = motion.result.value;
  if (captureEvidence) console.log(`SVG motion evidence: ${JSON.stringify(motionValue)}`);
  if (motionValue.packetTravel < 10 || motionValue.discTravel < 100 || !motionValue.discReturn || motionValue.landingError > 20 || motionValue.discOpacity > .1 || motionValue.ufoOpacity < .9 || motionValue.tapOpacity < .9 || motionValue.riderOpacity < .9 || motionValue.dropOpacity < .9 || motionValue.bigfootTranslate === 'none' || motionValue.bigfootTranslate === '0px' || motionValue.armStart === motionValue.armEnd || motionValue.wheelStart === motionValue.wheelEnd || motionValue.frame !== 'none' || motionValue.labels.join('|') !== 'Hiking|Camping|Cycling|Disc golf|Craft beer') throw new Error(`SVG motion regression: ${JSON.stringify(motionValue)}`);

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
  await new Promise((done) => setTimeout(done, 150));
  const preferences = await send('Runtime.evaluate', { expression: `({dark:matchMedia('(prefers-color-scheme: dark)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,ddns:getComputedStyle(document.querySelector('.ddns-packets')).display,flight:getComputedStyle(document.querySelector('.hobby-traveler')).display,landed:getComputedStyle(document.querySelector('.hobby-landed-disc')).display})`, returnByValue: true });
  if (!preferences.result.value.dark || !preferences.result.value.reduced || preferences.result.value.ddns !== 'none' || preferences.result.value.flight !== 'none' || preferences.result.value.landed === 'none') throw new Error(`preference emulation failed: ${JSON.stringify(preferences.result.value)}`);
  if (captureEvidence) {
    await send('Runtime.evaluate', { expression: `document.documentElement.style.scrollBehavior='auto';document.querySelector('#off-the-clock').scrollIntoView({block:'end'})` });
    await new Promise((done) => setTimeout(done, 100));
    const reducedCapture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync('/tmp/bolens-hobbies-reduced-dark-1440.png', Buffer.from(reducedCapture.data, 'base64'));
  }

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
