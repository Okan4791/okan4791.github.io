(() => {
  const canvas = document.querySelector('.camp-atmosphere');
  const figure = canvas?.closest('.cryptid-camp');
  const svg = figure?.querySelector('svg');
  if (!canvas || !figure || !svg) return;

  const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!context) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const restrained = navigator.connection?.saveData || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const targetInterval = 1000 / (restrained ? 20 : 30);
  const random = (() => {
    let state = 0x404cafe;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const range = (low, high) => low + (high - low) * random();

  const stars = Array.from({ length: restrained ? 34 : 58 }, () => ({
    x: range(20, 1180), y: range(22, 248), radius: range(.35, 1.05), phase: range(0, Math.PI * 2), speed: range(.09, .19), alpha: range(.12, .34)
  })).filter(({ x, y }) => Math.hypot(x - 1002, y - 118) > 70);
  const fireflies = Array.from({ length: restrained ? 12 : 20 }, () => ({
    x: range(45, 1155), y: range(470, 625), radius: range(1.1, 2.1), phase: range(0, Math.PI * 2), speed: range(.22, .42), drift: range(2, 7)
  })).filter(({ x }) => Math.abs(x - 610) > 100);
  const embers = Array.from({ length: restrained ? 7 : 12 }, () => ({
    x: range(-24, 24), lift: range(22, 78), sway: range(-12, 12), radius: range(.8, 1.8), phase: range(0, 1)
  }));
  const grain = Array.from({ length: restrained ? 80 : 150 }, () => ({
    x: random(), y: random(), radius: range(.25, .75), alpha: range(.012, .038)
  }));
  const createGlowSprite = (size, colors) => {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const spriteContext = sprite.getContext('2d');
    const gradient = spriteContext.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    colors.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    spriteContext.fillStyle = gradient;
    spriteContext.fillRect(0, 0, size, size);
    return sprite;
  };
  const fireflyGlow = createGlowSprite(32, [[0, 'rgba(225,251,137,1)'], [.25, 'rgba(204,235,111,.45)'], [1, 'rgba(190,225,100,0)']]);
  const grainLayer = document.createElement('canvas');
  const grainContext = grainLayer.getContext('2d');

  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let frameId = 0;
  let previousTime = 0;
  let visible = !document.hidden;

  const resize = () => {
    const bounds = figure.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    pixelRatio = Math.min(devicePixelRatio || 1, restrained ? 1.25 : 1.5);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    grainLayer.width = Math.round(width * pixelRatio);
    grainLayer.height = Math.round(height * pixelRatio);
    grainContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    grainContext.clearRect(0, 0, width, height);
    grainContext.fillStyle = 'rgb(202 218 207)';
    grain.forEach((speck) => {
      grainContext.globalAlpha = speck.alpha;
      grainContext.fillRect(speck.x * width, speck.y * height, speck.radius, speck.radius);
    });
    grainContext.globalAlpha = 1;
    if (reducedMotion.matches) draw(7.25);
  };

  const sceneTransform = () => {
    const figureBounds = figure.getBoundingClientRect();
    const svgBounds = svg.getBoundingClientRect();
    const scale = Math.max(svgBounds.width / 1200, svgBounds.height / 760);
    return {
      scale,
      x: svgBounds.left - figureBounds.left + (svgBounds.width - 1200 * scale) / 2,
      y: svgBounds.top - figureBounds.top + svgBounds.height - 760 * scale
    };
  };

  const paintGlow = (x, y, radius, stops) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  };

  const draw = (time) => {
    context.clearRect(0, 0, width, height);
    const view = sceneTransform();
    const point = (x, y) => [view.x + x * view.scale, view.y + y * view.scale];

    context.save();
    context.globalCompositeOperation = 'screen';

    stars.forEach((star) => {
      const [x, y] = point(star.x, star.y);
      const luminance = star.alpha * (.72 + .28 * Math.sin(time * star.speed + star.phase));
      context.fillStyle = `rgba(218,236,232,${luminance})`;
      context.beginPath();
      context.arc(x, y, Math.max(.45, star.radius * view.scale), 0, Math.PI * 2);
      context.fill();
    });

    const fogTime = reducedMotion.matches ? 0 : time * .018;
    [[330, 492, 245, 25, .038], [865, 515, 295, 32, .045], [620, 575, 215, 22, .032]].forEach(([x, y, rx, ry, alpha], index) => {
      const [cx, cy] = point(x + Math.sin(fogTime + index * 1.8) * 13, y);
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, rx * view.scale);
      gradient.addColorStop(0, `rgba(184,207,199,${alpha})`);
      gradient.addColorStop(.62, `rgba(128,166,157,${alpha * .55})`);
      gradient.addColorStop(1, 'rgba(100,140,134,0)');
      context.save();
      context.translate(cx, cy);
      context.scale(1, ry / rx);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(0, 0, rx * view.scale, 0, Math.PI * 2);
      context.fill();
      context.restore();
    });

    const [fireX, fireY] = point(610, 656);
    const firePulse = reducedMotion.matches ? 1 : .975 + .025 * Math.sin(time * 2.4) + .012 * Math.sin(time * 4.1 + 1.2);
    paintGlow(fireX, fireY, 176 * view.scale * firePulse, [[0, 'rgba(255,170,70,.105)'], [.38, 'rgba(242,103,48,.052)'], [1, 'rgba(242,90,40,0)']]);

    fireflies.forEach((fly) => {
      const wave = .5 + .5 * Math.sin(time * fly.speed + fly.phase);
      const alpha = .045 + .3 * wave * wave;
      const [x, y] = point(fly.x + Math.sin(time * .13 + fly.phase) * fly.drift, fly.y + Math.cos(time * .1 + fly.phase) * 2.5);
      const glowSize = 16 * view.scale;
      context.globalAlpha = alpha;
      context.drawImage(fireflyGlow, x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
      context.globalAlpha = 1;
      context.fillStyle = `rgba(234,255,159,${Math.min(.52, alpha + .12)})`;
      context.beginPath();
      context.arc(x, y, Math.max(.7, fly.radius * view.scale), 0, Math.PI * 2);
      context.fill();
    });

    embers.forEach((ember) => {
      const progress = (time * .15 + ember.phase) % 1;
      const alpha = Math.sin(progress * Math.PI) * .48;
      const x = fireX + (ember.x + ember.sway * progress + Math.sin(time + ember.phase * 9) * 3) * view.scale;
      const y = fireY - (12 + ember.lift * progress) * view.scale;
      context.fillStyle = `rgba(255,196,91,${alpha})`;
      context.beginPath();
      context.arc(x, y, Math.max(.6, ember.radius * view.scale * (1 - progress * .45)), 0, Math.PI * 2);
      context.fill();
    });

    context.globalCompositeOperation = 'soft-light';
    context.drawImage(grainLayer, 0, 0, grainLayer.width, grainLayer.height, 0, 0, width, height);
    context.restore();
  };

  const animate = (timestamp) => {
    if (!visible || reducedMotion.matches) return;
    frameId = requestAnimationFrame(animate);
    if (timestamp - previousTime < targetInterval) return;
    previousTime = timestamp;
    draw(timestamp / 1000);
  };

  const updateMotion = () => {
    cancelAnimationFrame(frameId);
    if (reducedMotion.matches) {
      draw(7.25);
    } else if (visible) {
      previousTime = 0;
      frameId = requestAnimationFrame(animate);
    }
  };

  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    updateMotion();
  });
  reducedMotion.addEventListener?.('change', updateMotion);
  new ResizeObserver(resize).observe(figure);
  resize();
  figure.classList.add('hybrid-effects-ready');
  updateMotion();
})();
