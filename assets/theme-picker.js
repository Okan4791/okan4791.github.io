(() => {
  const palettes = {
    alpine: { label: 'Alpine', light: '#edf4f3', dark: '#102322' },
    desert: { label: 'High Desert', light: '#f3ead8', dark: '#211914' },
    glacier: { label: 'Glacier', light: '#eaf1f4', dark: '#10232f' },
    signal: { label: 'Night Signal', light: '#f0edf5', dark: '#1d1729' },
  };
  const storageKey = 'portfolio-palette';
  const themeStorageKey = 'portfolio-theme';
  let selected = 'glacier';
  let selectedTheme = 'auto';
  const requested = new URLSearchParams(location.search).get('palette');

  if (requested in palettes) selected = requested;
  else try {
    const saved = localStorage.getItem(storageKey);
    if (saved in palettes) selected = saved;
  } catch {}
  try {
    const savedTheme = localStorage.getItem(themeStorageKey);
    if (['auto', 'day', 'night'].includes(savedTheme)) selectedTheme = savedTheme;
  } catch {}

  const applyPalette = (name) => {
    selected = name in palettes ? name : 'glacier';
    document.documentElement.dataset.palette = selected;
    const palette = palettes[selected];
    document.querySelector('meta[name="theme-color"][media*="light"]')?.setAttribute('content', palette.light);
    document.querySelector('meta[name="theme-color"][media*="dark"]')?.setAttribute('content', palette.dark);
    document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', palette.dark);
    try { localStorage.setItem(storageKey, selected); } catch {}
  };

  applyPalette(selected);
  const applyTheme = (theme) => {
    selectedTheme = ['auto', 'day', 'night'].includes(theme) ? theme : 'auto';
    if (selectedTheme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = selectedTheme;
    try { localStorage.setItem(themeStorageKey, selectedTheme); } catch {}
  };
  applyTheme(selectedTheme);

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

    const themeFieldset = document.createElement('fieldset');
    themeFieldset.className = 'theme-options';
    themeFieldset.innerHTML = `<legend>Choose an appearance</legend>${['auto', 'day', 'night'].map((theme) => `<label><input type="radio" name="portfolio-theme" value="${theme}"${theme === selectedTheme ? ' checked' : ''}><span>${theme === 'auto' ? 'System' : theme[0].toUpperCase() + theme.slice(1)}</span></label>`).join('')}`;
    picker.append(themeFieldset);

    picker.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.target.name === 'portfolio-theme') applyTheme(event.target.value);
      else applyPalette(event.target.value);
    });
    document.addEventListener('pointerdown', (event) => {
      if (picker.open && !picker.contains(event.target)) picker.removeAttribute('open');
    });
    document.body.append(picker);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPicker, { once: true });
  else mountPicker();
})();
