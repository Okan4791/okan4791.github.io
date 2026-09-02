(() => {
  const palettes = {
    alpine: { label: 'Alpine', light: '#edf4f3', dark: '#102322' },
    desert: { label: 'High Desert', light: '#f3ead8', dark: '#211914' },
    glacier: { label: 'Glacier', light: '#eaf1f4', dark: '#10232f' },
    signal: { label: 'Night Signal', light: '#f0edf5', dark: '#1d1729' },
  };
  const storageKey = 'portfolio-palette';
  let selected = 'alpine';
  const requested = new URLSearchParams(location.search).get('palette');

  if (requested in palettes) selected = requested;
  else try {
    const saved = localStorage.getItem(storageKey);
    if (saved in palettes) selected = saved;
  } catch {}

  const applyPalette = (name) => {
    selected = name in palettes ? name : 'alpine';
    document.documentElement.dataset.palette = selected;
    const palette = palettes[selected];
    document.querySelector('meta[name="theme-color"][media*="light"]')?.setAttribute('content', palette.light);
    document.querySelector('meta[name="theme-color"][media*="dark"]')?.setAttribute('content', palette.dark);
    try { localStorage.setItem(storageKey, selected); } catch {}
  };

  applyPalette(selected);

  const mountPicker = () => {
    const picker = document.createElement('details');
    picker.className = 'palette-picker';
    picker.innerHTML = `
      <summary><span class="palette-current" aria-hidden="true"></span><span>Palette</span></summary>
      <fieldset>
        <legend>Choose a color palette</legend>
        ${Object.entries(palettes).map(([name, palette]) => `
          <label data-palette-option="${name}">
            <input type="radio" name="portfolio-palette" value="${name}"${name === selected ? ' checked' : ''}>
            <span class="palette-swatches" aria-hidden="true"><i></i><i></i><i></i></span>
            <span>${palette.label}</span>
          </label>`).join('')}
      </fieldset>`;

    picker.addEventListener('change', (event) => {
      if (event.target instanceof HTMLInputElement) applyPalette(event.target.value);
    });
    document.addEventListener('pointerdown', (event) => {
      if (picker.open && !picker.contains(event.target)) picker.removeAttribute('open');
    });
    document.body.append(picker);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPicker, { once: true });
  else mountPicker();
})();
