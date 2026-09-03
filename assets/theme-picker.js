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
    let pickerReturnFocus = null;
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

    const choosePalette = (name) => {
      applyPalette(name);
      const control = picker.querySelector(`input[name="portfolio-palette"][value="${name}"]`);
      if (control) control.checked = true;
    };
    const chooseTheme = (theme) => {
      applyTheme(theme);
      const control = picker.querySelector(`input[name="portfolio-theme"][value="${theme}"]`);
      if (control) control.checked = true;
    };
    const copyText = (value) => navigator.clipboard?.writeText(value).catch(() => {});
    const sharePage = () => {
      if (navigator.share) return navigator.share({ title: document.title, url: location.href }).catch(() => {});
      return copyText(location.href);
    };
    const toggleTheme = () => {
      const isNight = selectedTheme === 'night' || (selectedTheme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      chooseTheme(isNight ? 'day' : 'night');
    };
    const cyclePalette = () => {
      const names = Object.keys(palettes);
      choosePalette(names[(names.indexOf(selected) + 1) % names.length]);
    };
    const sourcePath = location.pathname.endsWith('/') ? `${location.pathname.slice(1)}index.html` : location.pathname.slice(1);
    const pageSections = [
      ['condition', 'Condition', 'The starting state and constraints'],
      ['cause', 'Cause', 'What created the problem'],
      ['correction', 'Correction', 'How the system was improved'],
      ['confirm', 'Confirm', 'Results and verification'],
    ].filter(([id]) => document.getElementById(id));
    const commands = [
      { label: 'Home', detail: 'Portfolio overview', group: 'Go to', href: '/', shortcut: 'Alt H', ariaShortcut: 'Alt+H' },
      { label: 'Selected work', detail: 'Featured projects', group: 'Go to', href: '/#selected-work' },
      { label: 'Toolbox', detail: 'Languages, systems, and interfaces', group: 'Go to', href: '/#toolbox' },
      { label: 'Off the clock', detail: 'Interests beyond the terminal', group: 'Go to', href: '/#off-the-clock' },
      { label: 'All work', detail: 'Project index', group: 'Go to', href: '/work/', shortcut: 'Alt W', ariaShortcut: 'Alt+W' },
      { label: 'About Michael', detail: 'Approach, principles, and interests', group: 'Go to', href: '/about/', shortcut: 'Alt A', ariaShortcut: 'Alt+A' },
      ...pageSections.map(([id, label, detail]) => ({ label, detail, group: 'On this page', href: `#${id}`, keywords: `case study section ${id}` })),
      { label: 'uDDNS case study', detail: 'Dynamic DNS across multiple providers', group: 'Case study', href: '/case-studies/uddns/' },
      { label: 'AUR Response Toolkit', detail: 'Evidence-backed incident response', group: 'Case study', href: '/case-studies/aur-response-toolkit/' },
      { label: 'Privacy Devices', detail: 'Local-first privacy controls', group: 'Case study', href: '/case-studies/privacy-devices/' },
      { label: 'GitHub profile', detail: 'All repositories', group: 'Open', href: 'https://github.com/bolens' },
      { label: 'uDDNS project site', detail: 'Documentation and installation', group: 'Open', href: 'https://bolens.github.io/uddns/' },
      { label: 'uDDNS repository', detail: 'Source on GitHub', group: 'Open', href: 'https://github.com/bolens/uddns' },
      { label: 'AUR Response Toolkit project site', detail: 'Documentation and installation', group: 'Open', href: 'https://bolens.github.io/aur-response-toolkit/' },
      { label: 'AUR Response Toolkit repository', detail: 'Source on GitHub', group: 'Open', href: 'https://github.com/bolens/aur-response-toolkit' },
      { label: 'Privacy Devices project site', detail: 'Documentation and installation', group: 'Open', href: 'https://bolens.github.io/omarchy-privacy-devices/' },
      { label: 'Privacy Devices repository', detail: 'Source on GitHub', group: 'Open', href: 'https://github.com/bolens/omarchy-privacy-devices' },
      { label: 'Back', detail: 'Return to the previous page', group: 'Browser', keywords: 'history previous', run: () => history.back() },
      { label: 'Forward', detail: 'Move to the next page in history', group: 'Browser', keywords: 'history next', run: () => history.forward() },
      { label: 'Reload page', detail: 'Refresh the current page', group: 'Browser', keywords: 'refresh', run: () => location.reload() },
      { label: 'Copy page link', detail: 'Copy this page’s URL', group: 'Page', keywords: 'share url clipboard', run: () => copyText(location.href) },
      { label: 'Copy page title', detail: 'Copy the current document title', group: 'Page', keywords: 'clipboard', run: () => copyText(document.title) },
      { label: 'Share page', detail: 'Open device sharing options', group: 'Page', keywords: 'send link url copy', run: sharePage },
      { label: 'Print page', detail: 'Open the browser print dialog', group: 'Page', keywords: 'save pdf', run: () => window.print() },
      { label: 'View page source', detail: 'Open this page in the portfolio repository', group: 'Open', keywords: 'github code html', href: `https://github.com/bolens/bolens.github.io/blob/main/${sourcePath || 'index.html'}` },
      { label: 'Top of page', detail: 'Return to the beginning', group: 'On this page', keywords: 'scroll home', shortcut: 'Alt T', ariaShortcut: 'Alt+T', run: () => scrollTo({ top: 0, behavior: 'smooth' }) },
      { label: 'Bottom of page', detail: 'Jump to the end of the page', group: 'On this page', keywords: 'scroll end footer', run: () => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }) },
      { label: 'Focus main content', detail: 'Move keyboard focus past navigation', group: 'Accessibility', keywords: 'skip content', shortcut: 'Alt M', ariaShortcut: 'Alt+M', run: () => document.querySelector('main')?.focus() },
      { label: 'Command palette', detail: 'Search pages and run site actions', group: 'Command', keywords: 'shortcut search commands', shortcut: 'Alt K', ariaShortcut: 'Alt+K', run: () => openCommands() },
      { label: 'Keyboard shortcuts', detail: 'Show every available keyboard shortcut', group: 'Command', keywords: 'help hotkeys bindings', shortcut: 'Alt /', ariaShortcut: 'Alt+/', run: () => openCommands('shortcut') },
      { label: 'Choose palette', detail: 'Open color and appearance controls', group: 'Command', keywords: 'theme colors shortcut', shortcut: 'Alt P', ariaShortcut: 'Alt+P', run: () => { pickerReturnFocus = document.activeElement; picker.hidden = false; picker.open = true; picker.querySelector('summary')?.focus(); } },
      { label: 'Cycle color palette', detail: 'Move to the next color scheme', group: 'Palette', keywords: 'next theme colors', run: cyclePalette },
      ...Object.entries(palettes).map(([name, palette]) => ({ label: `Use ${palette.label} palette`, detail: 'Change the site color scheme', group: 'Palette', keywords: `${name} theme colors`, run: () => choosePalette(name) })),
      { label: 'Toggle day or night', detail: 'Switch between light and dark scenes', group: 'Theme', keywords: 'appearance mode', run: toggleTheme },
      { label: 'Use system appearance', detail: 'Follow the device setting', group: 'Theme', keywords: 'auto light dark', run: () => chooseTheme('auto') },
      { label: 'Use day appearance', detail: 'Switch to the light scene', group: 'Theme', keywords: 'light', run: () => chooseTheme('day') },
      { label: 'Use night appearance', detail: 'Switch to the dark scene', group: 'Theme', keywords: 'dark', run: () => chooseTheme('night') },
      { label: 'Reset color settings', detail: 'Restore Glacier and system appearance', group: 'Theme', keywords: 'default clear preferences', run: () => { choosePalette('glacier'); chooseTheme('auto'); } },
    ];
    const dialog = document.createElement('dialog');
    dialog.className = 'command-palette';
    dialog.setAttribute('aria-label', 'Site search and commands');
    dialog.innerHTML = `<div class="command-search"><span aria-hidden="true">⌕</span><input type="search" role="combobox" autocomplete="off" spellcheck="false" aria-label="Search pages and commands" aria-autocomplete="list" aria-controls="command-results" aria-expanded="false" placeholder="Search pages and commands…"><kbd>Esc</kbd></div><div class="command-results" id="command-results" role="listbox" aria-label="Results"></div><p class="command-empty" role="status" hidden>No matching trail found.</p><footer><span><kbd>↑</kbd><kbd>↓</kbd> Move</span><span><kbd>↵</kbd> Open</span></footer>`;
    document.body.append(dialog);
    const input = dialog.querySelector('input');
    const results = dialog.querySelector('.command-results');
    const empty = dialog.querySelector('.command-empty');
    let visible = commands;
    let active = 0;

    const renderCommands = () => {
      const query = input.value.trim().toLowerCase();
      const terms = query.split(/\s+/).filter(Boolean);
      visible = commands.filter((command) => {
        const searchable = `${command.label} ${command.detail} ${command.group} ${command.keywords ?? ''} ${command.shortcut ? `keyboard shortcut hotkey ${command.shortcut}` : ''}`.toLowerCase();
        return terms.every((term) => searchable.includes(term));
      });
      active = Math.min(active, Math.max(visible.length - 1, 0));
      results.innerHTML = visible.map((command, index) => `<button type="button" id="command-option-${index}" role="option" aria-selected="${index === active}"${command.ariaShortcut ? ` aria-keyshortcuts="${command.ariaShortcut}"` : ''} data-command-index="${index}"><span><b>${command.label}</b><small>${command.detail}</small></span><span class="command-meta"><i>${command.group}</i>${command.shortcut ? `<kbd>${command.shortcut}</kbd>` : ''}</span></button>`).join('');
      empty.hidden = visible.length > 0;
      if (visible.length) input.setAttribute('aria-activedescendant', `command-option-${active}`);
      else input.removeAttribute('aria-activedescendant');
      results.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    };
    const runCommand = (command) => {
      if (!command) return;
      dialog.close();
      if (command.run) command.run();
      else location.href = command.href;
    };
    function openCommands(query = '') {
      input.value = query;
      active = 0;
      renderCommands();
      dialog.showModal();
      input.setAttribute('aria-expanded', 'true');
      input.focus();
    }
    dialog.addEventListener('close', () => input.setAttribute('aria-expanded', 'false'));
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

    window.addEventListener('keydown', (event) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const keyCode = event.code || `Key${event.key.toUpperCase()}`;
      const altShortcut = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
      const fallbackShortcut = event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
      if (event.key === 'Escape' && !picker.hidden) {
        picker.open = false;
        picker.hidden = true;
        if (pickerReturnFocus instanceof HTMLElement) pickerReturnFocus.focus();
        pickerReturnFocus = null;
        return;
      }
      if (keyCode === 'KeyK' && (altShortcut || fallbackShortcut)) {
        event.preventDefault();
        if (dialog.open) dialog.close();
        else openCommands();
        return;
      }
      if (isEditing) return;
      if (keyCode === 'KeyP' && (altShortcut || fallbackShortcut)) {
        event.preventDefault();
        if (picker.hidden) pickerReturnFocus = document.activeElement;
        picker.hidden = !picker.hidden;
        picker.open = !picker.hidden;
        if (!picker.hidden) picker.querySelector('summary')?.focus();
        else if (pickerReturnFocus instanceof HTMLElement) pickerReturnFocus.focus();
        return;
      }
      if (!altShortcut) return;
      const shortcuts = {
        KeyH: () => { location.href = '/'; },
        KeyW: () => { location.href = '/work/'; },
        KeyA: () => { location.href = '/about/'; },
        KeyT: () => scrollTo({ top: 0, behavior: 'smooth' }),
        KeyM: () => document.querySelector('main')?.focus(),
        Slash: () => openCommands('shortcut'),
      };
      if (!shortcuts[keyCode]) return;
      event.preventDefault();
      shortcuts[keyCode]();
    }, { capture: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPicker, { once: true });
  else mountPicker();
})();
