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
    document.querySelector('meta[name="theme-color"][media*="light"]')?.setAttribute('content', selectedTheme === 'night' ? palette.dark : palette.light);
    document.querySelector('meta[name="theme-color"][media*="dark"]')?.setAttribute('content', selectedTheme === 'day' ? palette.light : palette.dark);
    document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', selectedTheme === 'day' ? palette.light : palette.dark);
    try { localStorage.setItem(storageKey, selected); } catch {}
  };

  applyPalette(selected);
  const applyTheme = (theme) => {
    selectedTheme = ['auto', 'day', 'night'].includes(theme) ? theme : 'auto';
    if (selectedTheme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = selectedTheme;
    const palette = palettes[selected];
    document.querySelector('meta[name="theme-color"][media*="light"]')?.setAttribute('content', selectedTheme === 'night' ? palette.dark : palette.light);
    document.querySelector('meta[name="theme-color"][media*="dark"]')?.setAttribute('content', selectedTheme === 'day' ? palette.light : palette.dark);
    document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', selectedTheme === 'day' ? palette.light : palette.dark);
    try { localStorage.setItem(themeStorageKey, selectedTheme); } catch {}
  };
  applyTheme(selectedTheme);

  const mountPicker = () => {
    const picker = document.createElement('details');
    picker.className = 'palette-picker';
    picker.hidden = true;
    picker.innerHTML = `
      <summary><span class="palette-current" aria-hidden="true"></span><span>Palette</span></summary>
      <div class="palette-panels"><fieldset>
        <legend>Choose a color palette</legend>
        ${Object.entries(palettes).map(([name, palette]) => `
          <label data-palette-option="${name}">
            <input type="radio" name="portfolio-palette" value="${name}"${name === selected ? ' checked' : ''}>
            <span class="palette-swatches" aria-hidden="true"><i></i><i></i><i></i></span>
            <span>${palette.label}</span>
          </label>`).join('')}
      </fieldset></div>`;

    const themeFieldset = document.createElement('fieldset');
    themeFieldset.className = 'theme-options';
    themeFieldset.innerHTML = `<legend>Choose an appearance</legend>${['auto', 'day', 'night'].map((theme) => `<label><input type="radio" name="portfolio-theme" value="${theme}"${theme === selectedTheme ? ' checked' : ''}><span>${theme === 'auto' ? 'System' : theme[0].toUpperCase() + theme.slice(1)}</span></label>`).join('')}`;
    picker.querySelector('.palette-panels').append(themeFieldset);

    picker.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.target.name === 'portfolio-theme') applyTheme(event.target.value);
      else applyPalette(event.target.value);
    });
    document.addEventListener('pointerdown', (event) => {
      if (picker.open && !picker.contains(event.target)) picker.removeAttribute('open');
    });
    document.body.append(picker);

    const commands = [
      { label: 'Home', detail: 'Portfolio overview', group: 'Go to', href: '/' },
      { label: 'Selected work', detail: 'Featured projects', group: 'Go to', href: '/#selected-work' },
      { label: 'All work', detail: 'Project index', group: 'Go to', href: '/work/' },
      { label: 'About Michael', detail: 'Approach, principles, and interests', group: 'Go to', href: '/about/' },
      { label: 'uDDNS case study', detail: 'Dynamic DNS across multiple providers', group: 'Case study', href: '/case-studies/uddns/' },
      { label: 'AUR Response Toolkit', detail: 'Evidence-backed incident response', group: 'Case study', href: '/case-studies/aur-response-toolkit/' },
      { label: 'Privacy Devices', detail: 'Local-first privacy controls', group: 'Case study', href: '/case-studies/privacy-devices/' },
      { label: 'GitHub profile', detail: 'All repositories', group: 'Open', href: 'https://github.com/bolens' },
      { label: 'uDDNS repository', detail: 'Source on GitHub', group: 'Open', href: 'https://github.com/bolens/uddns' },
      { label: 'AUR Response Toolkit repository', detail: 'Source on GitHub', group: 'Open', href: 'https://github.com/bolens/aur-response-toolkit' },
      { label: 'Privacy Devices repository', detail: 'Source on GitHub', group: 'Open', href: 'https://github.com/bolens/omarchy-privacy-devices' },
      { label: 'Choose palette', detail: 'Open color and appearance controls', group: 'Command', keywords: 'theme colors', run: () => { picker.hidden = false; picker.open = true; picker.querySelector('summary')?.focus(); } },
      { label: 'Use system appearance', detail: 'Follow the device setting', group: 'Theme', keywords: 'auto light dark', run: () => applyTheme('auto') },
      { label: 'Use day appearance', detail: 'Switch to the light scene', group: 'Theme', keywords: 'light', run: () => applyTheme('day') },
      { label: 'Use night appearance', detail: 'Switch to the dark scene', group: 'Theme', keywords: 'dark', run: () => applyTheme('night') },
    ];
    const dialog = document.createElement('dialog');
    dialog.className = 'command-palette';
    dialog.setAttribute('aria-label', 'Site search and commands');
    dialog.innerHTML = `<div class="command-search"><span aria-hidden="true">⌕</span><input type="search" autocomplete="off" spellcheck="false" aria-label="Search pages and commands" placeholder="Search pages and commands…"><kbd>Esc</kbd></div><div class="command-results" role="listbox" aria-label="Results"></div><p class="command-empty" hidden>No matching trail found.</p><footer><span><kbd>↑</kbd><kbd>↓</kbd> Move</span><span><kbd>↵</kbd> Open</span></footer>`;
    document.body.append(dialog);
    const input = dialog.querySelector('input');
    const results = dialog.querySelector('.command-results');
    const empty = dialog.querySelector('.command-empty');
    let visible = commands;
    let active = 0;

    const renderCommands = () => {
      const query = input.value.trim().toLowerCase();
      visible = commands.filter((command) => `${command.label} ${command.detail} ${command.group} ${command.keywords ?? ''}`.toLowerCase().includes(query));
      active = Math.min(active, Math.max(visible.length - 1, 0));
      results.innerHTML = visible.map((command, index) => `<button type="button" role="option" aria-selected="${index === active}" data-command-index="${index}"><span><b>${command.label}</b><small>${command.detail}</small></span><i>${command.group}</i></button>`).join('');
      empty.hidden = visible.length > 0;
      results.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    };
    const runCommand = (command) => {
      if (!command) return;
      dialog.close();
      if (command.run) command.run();
      else location.href = command.href;
    };
    const openCommands = () => {
      input.value = '';
      active = 0;
      renderCommands();
      dialog.showModal();
      input.focus();
    };
    input.addEventListener('input', () => { active = 0; renderCommands(); });
    results.addEventListener('pointermove', (event) => {
      const option = event.target.closest('[data-command-index]');
      if (!option) return;
      active = Number(option.dataset.commandIndex);
      renderCommands();
    });
    results.addEventListener('click', (event) => runCommand(visible[Number(event.target.closest('[data-command-index]')?.dataset.commandIndex)]));
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Enter') return runCommand(visible[active]);
      if (!visible.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      renderCommands();
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.key === 'Escape' && !picker.hidden) {
        picker.open = false;
        picker.hidden = true;
        return;
      }
      if (event.key.toLowerCase() === 'k' && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        if (dialog.open) dialog.close();
        else openCommands();
        return;
      }
      if (isEditing || event.key.toLowerCase() !== 'p' || !event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      picker.hidden = !picker.hidden;
      picker.open = !picker.hidden;
      if (!picker.hidden) picker.querySelector('summary')?.focus();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPicker, { once: true });
  else mountPicker();
})();
