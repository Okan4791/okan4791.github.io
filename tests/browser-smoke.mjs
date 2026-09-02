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
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const { text: entryText, url: entryUrl = '' } = message.params.entry;
      const expected404 = entryUrl === 'http://127.0.0.1:4173/missing-route' && entryText.includes('404');
      if (!expected404) errors.push(`${entryText}${entryUrl ? ` (${entryUrl})` : ''}`);
    }
    if (message.method === 'Network.loadingFailed' && !message.params.canceled) errors.push(message.params.errorText);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const capturePhase = async (width, name, selector, time, path = '/') => {
    await send('Page.navigate', { url: `http://127.0.0.1:4173${path}` });
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
      const fineAbduction=Array.from({length:41},(_,index)=>2640+index*120);
      const fineHandoffs=[...Array.from({length:37},(_,index)=>8400+index*120),...Array.from({length:15},(_,index)=>15600+index*120)];
      const fineCatch=Array.from({length:9},(_,index)=>21360+index*120);
      const finePeople=[...Array.from({length:17},(_,index)=>index*120),...Array.from({length:17},(_,index)=>22080+index*120)];
      await captureSequence(width, 'hobbies', '#off-the-clock', [...new Set([0, 200, 360, 600, 720, 800, 840, 960, 1080, 1200, 1440, 1600, 1920, 2400, 2600, 2880, 3200, 3360, 3600, 4000, 4320, 4400, 4560, 4800, 5040, 5200, 5520, 5600, 5760, 6200, 6240, 6480, 6800, 6960, 7000, 7200, 7440, 7600, 7680, 7920, 8000, 8160, 8200, 8400, 8800, 9000, 9120, 9360, 9600, 10000, 10400, 10800, 11000, 11200, 11280, 11520, 11640, 11880, 12000, 12120, 12240, 12480, 12600, 12840, 12960, 13080, 13200, 13320, 13600, 14000, 14400, 14800, 15200, 15600, 15840, 15960, 16000, 16200, 16440, 16560, 16680, 16800, 17200, 18000, 18960, 20000, 20160, 21000, 21600, 21840, 22000, 22400, 23280,...fineAbduction,...fineHandoffs,...fineCatch,...finePeople])].sort((a,b)=>a-b));
      await capturePhase(width, 'uddns', '.visual-ddns', 0);
      await capturePhase(width, 'uddns', '.visual-ddns', 1800);
      for (const time of [0,240,480,800,1200,1600,1900,2220,2540,3200,4800,7000,11000,14000]) await capturePhase(width, '404-scene', '.cryptid-camp', time, '/missing-route');
    }
  }

  await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
  await new Promise((done) => setTimeout(done, 200));
  const paletteSelection = await send('Runtime.evaluate', { expression: `(()=>{const inputs=[...document.querySelectorAll('.palette-picker input[name="portfolio-palette"]')];const glacier=inputs.find((input)=>input.value==='glacier');glacier.checked=true;glacier.dispatchEvent(new Event('change',{bubbles:true}));const style=getComputedStyle(document.documentElement);return {count:inputs.length,selected:document.documentElement.dataset.palette,accent:style.getPropertyValue('--copper').trim()}})()`, returnByValue: true });
  const paletteValue = paletteSelection.result.value;
  if (paletteValue.count !== 4 || paletteValue.selected !== 'glacier' || !['#28769c','#70bce2'].includes(paletteValue.accent)) throw new Error(`palette selection failed: ${JSON.stringify(paletteValue)}`);
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/about/' });
  await new Promise((done) => setTimeout(done, 200));
  const persistedPalette = await send('Runtime.evaluate', { expression: `({selected:document.documentElement.dataset.palette,checked:document.querySelector('.palette-picker input:checked')?.value})`, returnByValue: true });
  if (persistedPalette.result.value.selected !== 'glacier' || persistedPalette.result.value.checked !== 'glacier') throw new Error(`palette persistence failed: ${JSON.stringify(persistedPalette.result.value)}`);
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
  await new Promise((done) => setTimeout(done, 200));
  const sceneThemes = await send('Runtime.evaluate', { expression: `(()=>{const themeInput=(value)=>document.querySelector('.theme-options input[value="'+value+'"]');const inspect=()=>({theme:document.documentElement.dataset.theme||'auto',night:getComputedStyle(document.querySelector('.hike-stars')).visibility,day:getComputedStyle(document.querySelector('.hike-day-sun')).visibility,sky:getComputedStyle(document.documentElement).getPropertyValue('--scene-sky').trim()});const day=themeInput('day');day.checked=true;day.dispatchEvent(new Event('change',{bubbles:true}));const dayState=inspect();const night=themeInput('night');night.checked=true;night.dispatchEvent(new Event('change',{bubbles:true}));const nightState=inspect();return {count:document.querySelectorAll('.theme-options input').length,dayState,nightState}})()`, returnByValue: true });
  const sceneThemeValue = sceneThemes.result.value;
  if (sceneThemeValue.count !== 3 || sceneThemeValue.dayState.theme !== 'day' || sceneThemeValue.dayState.night !== 'hidden' || sceneThemeValue.dayState.day !== 'visible' || sceneThemeValue.nightState.theme !== 'night' || sceneThemeValue.nightState.night !== 'visible' || sceneThemeValue.nightState.day !== 'hidden' || sceneThemeValue.dayState.sky === sceneThemeValue.nightState.sky) throw new Error(`scene theme switching failed: ${JSON.stringify(sceneThemeValue)}`);
  if (captureEvidence) {
    for (const time of [1200,4320,7440,21600]) await capturePhase(1440, 'theme-night', '#off-the-clock', time);
    await send('Runtime.evaluate', { expression: `document.querySelector('.theme-options input[value="day"]').click()` });
    for (const time of [1200,4320,7440,21600]) await capturePhase(1440, 'theme-day', '#off-the-clock', time);
  }
  await send('Runtime.evaluate', { expression: `localStorage.removeItem('portfolio-palette');localStorage.removeItem('portfolio-theme');document.documentElement.dataset.palette='alpine';delete document.documentElement.dataset.theme` });

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
    hobby.setCurrentTime(22);const discEnd=center(discForm.getBoundingClientRect());
    const basket=center(document.querySelector('.disc-basket-rim').getBoundingClientRect());
    for(const form of [discForm,ufoForm]){const formAnimation=form.getAnimations()[0];formAnimation.pause();formAnimation.currentTime=2600}
    const discOpacity=Number(getComputedStyle(discForm).opacity);const ufoOpacity=Number(getComputedStyle(ufoForm).opacity);
    const beam=document.querySelector('.ufo-beam');const beamAnimation=beam.getAnimations()[0];beamAnimation.pause();const beamOpacity=[];for(const time of [2400,4800,6000,8160,8400,9600]){beamAnimation.currentTime=time;beamOpacity.push(Number(getComputedStyle(beam).opacity))}const bikeDropSequence=[];for(const time of [7440,7680,7920,8160]){hobby.setCurrentTime(time/1000);beamAnimation.currentTime=time;const ufoCenter=center(document.querySelector('.ufo-shell').getBoundingClientRect());bikeDropSequence.push({time,x:ufoCenter.x,y:ufoCenter.y,beam:Number(getComputedStyle(beam).opacity),beamScale:getComputedStyle(beam).scale})}
    const tapForm=document.querySelector('.beer-tap');const tapAnimation=tapForm.getAnimations()[0];tapAnimation.pause();tapAnimation.currentTime=11520;const tapEntry={opacity:Number(getComputedStyle(tapForm).opacity),scale:getComputedStyle(tapForm).scale};tapAnimation.currentTime=14000;const tapFilled={opacity:Number(getComputedStyle(tapForm).opacity),scale:getComputedStyle(tapForm).scale};tapAnimation.currentTime=16320;const tapExit={opacity:Number(getComputedStyle(tapForm).opacity),scale:getComputedStyle(tapForm).scale};tapAnimation.currentTime=14000;const handoff=document.querySelector('.beer-disc-handoff');const handoffAnimation=handoff.getAnimations()[0];handoffAnimation.pause();const handoffContinuity=[];for(const time of [11760,12000,12240,16080,16320,16560]){tapAnimation.currentTime=time;handoffAnimation.currentTime=time;const discAnimation=discForm.getAnimations()[0];discAnimation.currentTime=time;handoffContinuity.push(Number(getComputedStyle(tapForm).opacity)+Number(getComputedStyle(handoff).opacity)+Number(getComputedStyle(discForm).opacity))}tapAnimation.currentTime=14000;hobby.setCurrentTime(12);const flyingDiscAtTap=center(discForm.getBoundingClientRect());const fixedDiscAtTap=center(handoff.getBoundingClientRect());const handoffGap=Math.hypot(flyingDiscAtTap.x-fixedDiscAtTap.x,flyingDiscAtTap.y-fixedDiscAtTap.y);
    const liquid=document.querySelector('.beer-liquid');const liquidAnimation=liquid.getAnimations()[0];liquidAnimation.pause();liquidAnimation.currentTime=11500;const liquidBeforeFill=Number(getComputedStyle(liquid).opacity);liquidAnimation.currentTime=14000;const foam=document.querySelector('.beer-foam');const foamAnimation=foam.getAnimations()[0];foamAnimation.pause();foamAnimation.currentTime=11500;const foamBeforeFill=Number(getComputedStyle(foam).opacity);foamAnimation.currentTime=14000;const foamDuringFill=Number(getComputedStyle(foam).opacity);liquidAnimation.currentTime=20000;foamAnimation.currentTime=20000;const beerAfterDeparture={liquid:Number(getComputedStyle(liquid).opacity),foam:Number(getComputedStyle(foam).opacity)};liquidAnimation.currentTime=14000;foamAnimation.currentTime=14000;
    const bigfoot=document.querySelector('.route-bigfoot');const bigfootAnimation=bigfoot.getAnimations()[0];bigfootAnimation.pause();const bigfootOpacity=[];for(const time of [4320,5760,8160]){bigfootAnimation.currentTime=time;bigfootOpacity.push(Number(getComputedStyle(bigfoot).opacity))}hobby.setCurrentTime(3);const bigfootCamp=center(bigfoot.getBoundingClientRect());hobby.setCurrentTime(4.8);const bigfootBeam=center(bigfoot.getBoundingClientRect());const beamCenter=center(document.querySelector('.ufo-beam').getBoundingClientRect());hobby.setCurrentTime(5.76);const bigfootLifted=center(bigfoot.getBoundingClientRect());hobby.setCurrentTime(8.4);const bigfootBike=center(bigfoot.getBoundingClientRect());const bikeCenter=center(document.querySelector('.hobby-cycling svg').getBoundingClientRect());
    const campTree=document.querySelector('.route-camp-tree-foreground');const treeAnimation=campTree.getAnimations()[0];treeAnimation.pause();const treeVisibility=[];for(const time of [4800,5760,6480,7680]){treeAnimation.currentTime=time;treeVisibility.push(Number(getComputedStyle(campTree).opacity))}
    const anatomy=document.querySelector('.bigfoot-anatomy');const posture=anatomy.getAnimations()[0];posture.pause();posture.currentTime=9120;hobby.setCurrentTime(9.12);const screenPoint=(element,x,y)=>{const point=new DOMPoint(x,y).matrixTransform(element.getScreenCTM());return {x:point.x,y:point.y}};const riderHip=screenPoint(anatomy,0,15);const saddle=screenPoint(document.querySelector('.route-bike'),-6,28);const riderSaddleError=Math.hypot(riderHip.x-saddle.x,riderHip.y-saddle.y);const ufoBox=document.querySelector('.ufo-shell').getBoundingClientRect();const bike=document.querySelector('.route-bike');const bikeBox=bike.getBoundingClientRect();const rideStart=center(bikeBox);const bikeDepth=bike.getAnimations().find((item)=>item.animationName==='route-rider-depth');const bigfootDepth=bigfoot.getAnimations().find((item)=>item.animationName==='route-rider-depth');bikeDepth.pause();bigfootDepth.pause();bikeDepth.currentTime=9120;bigfootDepth.currentTime=9120;const rideScaleStart=Number(getComputedStyle(bike).scale);hobby.setCurrentTime(11.76);bikeDepth.currentTime=11760;bigfootDepth.currentTime=11760;const rideEnd=center(bike.getBoundingClientRect());const rideScaleEnd=Number(getComputedStyle(bike).scale);const riderScaleEnd=Number(getComputedStyle(bigfoot).scale);const rideDirection=rideEnd.x-rideStart.x;const rideDescent=rideEnd.y-rideStart.y;const ufoBikeClearance=bikeBox.top-ufoBox.bottom;
    const arm=document.querySelector('.throwing-arm');const armAnimation=arm.getAnimations()[0];armAnimation.pause();armAnimation.currentTime=0;const armStart=getComputedStyle(arm).rotate;armAnimation.currentTime=800;const armEnd=getComputedStyle(arm).rotate;
    const thrower=document.querySelector('.hobby-thrower');const throwerAnimation=thrower.getAnimations()[0];throwerAnimation.pause();throwerAnimation.currentTime=3200;const throwerExit={opacity:Number(getComputedStyle(thrower).opacity),translate:getComputedStyle(thrower).translate};
    const girl=document.querySelector('.walking-girl');const girlAnimation=girl.getAnimations()[0];girlAnimation.pause();girlAnimation.currentTime=1200;const dog=document.querySelector('.walking-dog');const dogAnimation=dog.getAnimations()[0];dogAnimation.pause();dogAnimation.currentTime=1200;const companions={girlOpacity:Number(getComputedStyle(girl).opacity),dogOpacity:Number(getComputedStyle(dog).opacity),dogBody:getComputedStyle(document.querySelector('.dog-body')).fill,dogHead:getComputedStyle(document.querySelector('.dog-head')).fill,glasses:getComputedStyle(document.querySelector('.man-glasses')).fill};
    const cheerers=document.querySelector('.hobby-cheerers');const cheerAnimation=cheerers.getAnimations()[0];cheerAnimation.pause();cheerAnimation.currentTime=22800;const cheerersFinish={opacity:Number(getComputedStyle(cheerers).opacity),translate:getComputedStyle(cheerers).translate};
    const flightPath=document.querySelector('#hobby-flight-path');const fixedInFlight=new DOMPoint(fixedDiscAtTap.x,fixedDiscAtTap.y).matrixTransform(hobby.getScreenCTM().inverse());const pathSamples=[.741,.746,.751,.756,.761].map((progress)=>{const point=flightPath.getPointAtLength(flightPath.getTotalLength()*progress).matrixTransform(flightPath.getScreenCTM());return {targetX:fixedInFlight.x,targetY:fixedInFlight.y,progress,x:point.x,y:point.y,gap:Math.hypot(point.x-fixedDiscAtTap.x,point.y-fixedDiscAtTap.y)}});
    const labels=[...document.querySelectorAll('.hobby-route li span')].map((label)=>label.textContent);
    const dimensions=(element)=>{const box=element.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height,fill:getComputedStyle(element).fill,stroke:getComputedStyle(element).stroke}};
    return {packetTravel:Math.hypot(packetEnd.x-packetStart.x,packetEnd.y-packetStart.y),discTravel:Math.hypot(discMiddle.x-discStart.x,discMiddle.y-discStart.y),discProgress:discEnd.x>discMiddle.x,landingError:Math.hypot(discEnd.x-basket.x,discEnd.y-basket.y),landingPoints:{disc:discEnd,basket},discOpacity,ufoOpacity,beamOpacity,bikeDropSequence,tapOpacity:Number(getComputedStyle(tapForm).opacity),tapEntry,tapFilled,tapExit,handoffContinuity,handoffGap,pathSamples,liquidBeforeFill,liquidScale:getComputedStyle(liquid).scale,foamBeforeFill,foamDuringFill,beerAfterDeparture,bigfootTravel:Math.hypot(bigfootBike.x-bigfootCamp.x,bigfootBike.y-bigfootCamp.y),bigfootLift:bigfootCamp.y-bigfootLifted.y,bigfootDrop:bigfootBike.y-bigfootLifted.y,beamAttachment:Math.hypot(bigfootBeam.x-beamCenter.x,bigfootBeam.y-beamCenter.y),bikeAttachment:Math.hypot(bigfootBike.x-bikeCenter.x,bigfootBike.y-bikeCenter.y),riderSaddleError,ufoBikeClearance,rideDirection,rideDescent,rideScaleStart,rideScaleEnd,riderScaleEnd,bigfootPoints:{camp:bigfootCamp,beam:bigfootBeam,lifted:bigfootLifted,bike:bigfootBike,beamCenter,bikeCenter,riderHip,saddle,rideStart,rideEnd,flyingDiscAtTap,fixedDiscAtTap},bigfootOpacity,throwerExit,companions,cheerersFinish,armStart,armEnd,wheelStart,wheelEnd,frame:getComputedStyle(frame).transform,discSize:dimensions(discForm),ufoShell:dimensions(document.querySelector('.ufo-shell')),ufoBeam:dimensions(document.querySelector('.ufo-beam')),tap:dimensions(tapForm),labels};
  })()`, returnByValue: true });
  const motionValue = motion.result.value;
  const treeTiming = await send('Runtime.evaluate', { expression: `(()=>{const tree=document.querySelector('.route-camp-tree-foreground');const animation=tree.getAnimations()[0];animation.pause();return [0,4800,5760,6480,7680,12000,18000,23990].map((time)=>{animation.currentTime=time;return Number(getComputedStyle(tree).opacity)})})()`, returnByValue: true });
  const treeVisibility = treeTiming.result.value;
  const detailChecks = await send('Runtime.evaluate', { expression: `(()=>{const throwing=document.querySelector('.throwing-arm');const relaxed=document.querySelector('.walking-arm');for(const animation of throwing.getAnimations())animation.pause();for(const animation of relaxed.getAnimations())animation.pause();throwing.getAnimations().find((animation)=>animation.animationName==='throw-arm-visibility').currentTime=1200;relaxed.getAnimations()[0].currentTime=1200;return {throwing:Number(getComputedStyle(throwing).opacity),relaxed:Number(getComputedStyle(relaxed).opacity),disc:getComputedStyle(document.querySelector('.disc-body')).fill,rim:getComputedStyle(document.querySelector('.disc-rim')).stroke,canopy:getComputedStyle(document.querySelector('.ufo-canopy')).fill,hull:getComputedStyle(document.querySelector('.ufo-shell')).fill,dogPaths:document.querySelectorAll('.dog-details').length,tapDetails:document.querySelectorAll('.tap-badge,.tap-badge-mark,.tap-hardware').length}})()`, returnByValue: true });
  const details = detailChecks.result.value;
  const catchChecks = await send('Runtime.evaluate', { expression: `(()=>{const traveler=document.querySelector('.traveler-disc');const caught=document.querySelector('.basket-caught-disc');const rim=document.querySelector('.disc-basket-rim');const travelerAnimation=traveler.getAnimations().find((item)=>item.animationName==='traveler-disc-form');const caughtAnimation=caught.getAnimations()[0];travelerAnimation.pause();caughtAnimation.pause();const samples=[21600,21840,22080,23990].map((time)=>{travelerAnimation.currentTime=time;caughtAnimation.currentTime=time;return {time,traveler:Number(getComputedStyle(traveler).opacity),caught:Number(getComputedStyle(caught).opacity)}});return {samples,behindRim:[...caught.parentElement.children].indexOf(caught)<[...rim.parentElement.children].indexOf(rim),sceneDetails:document.querySelectorAll('.camp-night-sky,.camp-fire,.cycle-sky,.cycle-hills,.disc-sky,.disc-course').length}})()`, returnByValue: true });
  const catchValue = catchChecks.result.value;
  const sceneColorChecks = await send('Runtime.evaluate', { expression: `(()=>{const liquid=document.querySelector('.beer-liquid');const foam=document.querySelector('.beer-fill-foam');const liquidColor=liquid.getAnimations().find((item)=>item.animationName==='beer-liquid-color');const foamColor=foam.getAnimations()[0];liquidColor.pause();foamColor.pause();liquidColor.currentTime=14000;foamColor.currentTime=14000;const active={liquid:getComputedStyle(liquid).fill,foam:getComputedStyle(foam).fill};liquidColor.currentTime=18000;foamColor.currentTime=18000;const settled={liquid:getComputedStyle(liquid).fill,foam:getComputedStyle(foam).fill};return {active,settled}})()`, returnByValue: true });
  const sceneColors = sceneColorChecks.result.value;
  const timelineChecks = await send('Runtime.evaluate', { expression: `(()=>{const hobby=document.querySelector('.hobby-flight-layer');const selectors=['.traveler-disc','.traveler-ufo','.ufo-beam','.route-bigfoot','.route-bike','.beer-tap','.tap-stream','.basket-caught-disc','.hobby-cheerers','.route-camp-tree-foreground'];const elements=selectors.map((selector)=>document.querySelector(selector));const sample=(time)=>{hobby.setCurrentTime(time/1000);for(const element of elements)for(const animation of element.getAnimations()){animation.pause();animation.currentTime=time}return {time,...Object.fromEntries(selectors.map((selector,index)=>[selector,Number(getComputedStyle(elements[index]).opacity)]))}};return [0,840,1440,4320,5760,7440,7680,7920,8400,9600,11760,12240,15600,16560,21360,21840,22080,22800,23990].map(sample)})()`, returnByValue: true });
  const timeline = timelineChecks.result.value;
  const peopleChecks = await send('Runtime.evaluate', { expression: `(()=>{const man=document.querySelector('.thrower-man').getBBox();const woman=document.querySelector('.walking-girl').getBBox();const dogs=[...document.querySelectorAll('.walking-dog,.cheerer-dog')].map((dog)=>{const box=dog.getBBox();const body=dog.querySelector('.dog-body').getBBox();return {ratio:box.width/box.height,legDrop:box.y+box.height-(body.y+body.height),eye:dog.querySelectorAll('.dog-eye').length,feathering:dog.querySelectorAll('.dog-feathering').length}});return {manRatio:man.height/8.4,womanRatio:woman.height/7.6,faces:document.querySelectorAll('.person-face').length,necks:document.querySelectorAll('.person-neck').length,hands:document.querySelectorAll('.person-hand').length,shoes:document.querySelectorAll('.person-shoes').length,clothes:document.querySelectorAll('.person-clothes,.girl-clothes').length,dogs}})()`, returnByValue: true });
  const people = peopleChecks.result.value;
  if (captureEvidence) console.log(`SVG motion evidence: ${JSON.stringify(motionValue)}`);
  if (motionValue.packetTravel < 10 || motionValue.discTravel < 100 || !motionValue.discProgress || motionValue.landingError > 1 || motionValue.discOpacity > .1 || motionValue.ufoOpacity < .9 || motionValue.ufoShell.width > motionValue.discSize.width * 1.5 || motionValue.beamOpacity[0] > .05 || motionValue.beamOpacity[1] < .8 || motionValue.beamOpacity[2] > .05 || motionValue.beamOpacity[3] < .7 || motionValue.beamOpacity[4] < .8 || motionValue.beamOpacity[5] > .05 || motionValue.tapOpacity < .9 || motionValue.tapEntry.opacity > .3 || motionValue.tapEntry.scale === 'none' || motionValue.tapFilled.opacity < .9 || motionValue.tapFilled.scale !== '1' || motionValue.tapExit.opacity > .7 || motionValue.tapExit.scale === '1' || motionValue.handoffContinuity.some((opacity)=>opacity<.8) || motionValue.liquidBeforeFill > .01 || motionValue.liquidScale === 'none' || motionValue.liquidScale === '1' || motionValue.foamBeforeFill > .01 || motionValue.foamDuringFill < .9 || motionValue.beerAfterDeparture.liquid < .9 || motionValue.beerAfterDeparture.foam < .9 || motionValue.bigfootTravel < 100 || motionValue.bigfootLift < 5 || motionValue.bigfootDrop < 5 || motionValue.beamAttachment > 30 || motionValue.bikeAttachment > 35 || motionValue.riderSaddleError > 12 || motionValue.ufoBikeClearance < 1 || motionValue.rideDirection < 50 || motionValue.rideDescent < 8 || motionValue.rideScaleStart < .95 || motionValue.rideScaleEnd > .75 || motionValue.riderScaleEnd > .75 || motionValue.bigfootOpacity[0] < .9 || motionValue.bigfootOpacity[1] > .05 || motionValue.bigfootOpacity[2] < .9 || motionValue.throwerExit.opacity > .8 || motionValue.throwerExit.translate === 'none' || motionValue.companions.girlOpacity < .9 || motionValue.companions.dogOpacity < .9 || motionValue.companions.dogBody === motionValue.companions.dogHead || motionValue.companions.glasses === motionValue.companions.dogBody || motionValue.cheerersFinish.opacity < .9 || motionValue.armStart === motionValue.armEnd || motionValue.wheelStart === motionValue.wheelEnd || motionValue.frame !== 'none' || motionValue.labels.join('|') !== 'Hiking|Camping|Cycling|Craft beer|Disc golf') throw new Error(`SVG motion regression: ${JSON.stringify(motionValue)}`);
  const [approach,stop,beamStart,beamDown]=motionValue.bikeDropSequence;const stoppedDrift=Math.hypot(stop.x-beamDown.x,stop.y-beamDown.y);if(approach.beam>.05||stop.beam>.05||beamStart.beam<=.05||beamDown.beam<.7||stoppedDrift>2)throw new Error(`SVG bike beam ordering: ${JSON.stringify({stoppedDrift,sequence:motionValue.bikeDropSequence})}`);
  if (motionValue.handoffGap > 5) throw new Error(`SVG tap handoff gap: ${motionValue.handoffGap}px`);
  if (motionValue.handoffContinuity.some((opacity)=>opacity>1.2)) throw new Error(`SVG tap handoff flash: ${JSON.stringify(motionValue.handoffContinuity)}`);
  if (treeVisibility.some((opacity)=>opacity<.9)) throw new Error(`SVG camp tree timing: ${JSON.stringify(treeVisibility)}`);
  if (details.throwing > .1 || details.relaxed < .9 || details.disc === details.rim || details.canopy === details.hull || details.dogPaths !== 2 || details.tapDetails !== 3) throw new Error(`SVG detail regression: ${JSON.stringify(details)}`);
  if (!catchValue.behindRim || catchValue.samples[0].traveler + catchValue.samples[0].caught < .8 || catchValue.samples[2].traveler > .1 || catchValue.samples[2].caught < .9 || catchValue.samples[3].traveler > .01 || catchValue.sceneDetails !== 6) throw new Error(`SVG basket catch regression: ${JSON.stringify(catchValue)}`);
  if (sceneColors.active.liquid === sceneColors.active.foam || sceneColors.settled.liquid !== sceneColors.settled.foam) throw new Error(`SVG beer color regression: ${JSON.stringify(sceneColors)}`);
  const phase=(time)=>timeline.find((item)=>item.time===time);if(phase(0)['.traveler-disc']<.9||phase(0)['.route-camp-tree-foreground']<.9||phase(1440)['.traveler-ufo']<.9||phase(1440)['.traveler-disc']>.1||phase(4320)['.route-bigfoot']<.9||phase(5760)['.route-bigfoot']>.1||phase(7680)['.ufo-beam']>.05||phase(7920)['.ufo-beam']<=.05||phase(8400)['.route-bigfoot']<.9||phase(9600)['.traveler-disc']<.9||phase(9600)['.traveler-ufo']>.1||phase(12240)['.beer-tap']<.9||phase(15600)['.tap-stream']<.9||phase(16560)['.beer-tap']>.1||phase(21840)['.basket-caught-disc']<.9||phase(22080)['.traveler-disc']>.1||phase(22800)['.hobby-cheerers']<.9||phase(23990)['.traveler-disc']>.01)throw new Error(`SVG narrative timeline regression: ${JSON.stringify(timeline)}`);
  if(people.manRatio<4.5||people.manRatio>6.5||people.womanRatio<4.5||people.womanRatio>6.5||people.faces!==4||people.necks!==4||people.hands<7||people.shoes!==4||people.clothes!==4||people.dogs.length!==2||people.dogs.some((dog)=>dog.ratio<1.4||dog.ratio>2.1||dog.legDrop<6||dog.eye!==1||dog.feathering!==1))throw new Error(`SVG figure detail regression: ${JSON.stringify(people)}`);

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
