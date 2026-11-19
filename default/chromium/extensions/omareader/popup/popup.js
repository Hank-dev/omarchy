const $ = (id) => document.getElementById(id);
const T = OmareaderTheme;
const DARK = T.normalize(T.DARK);
const LABELS = { normal: 'Normal', dark: 'Dark', omarchy: 'Follow Omarchy' };

const pretty = (name) =>
  (name || '')
    .replace(/^theme-/, '')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || '—';

let settings = T.normalizeSettings();
let hostname = '';

// The user's Omarchy monospace font, as the native host reports it, then the browser's.
function fontStack(family) {
  return typeof family === 'string' && /^[\p{L}\p{N} ._+-]{1,100}$/u.test(family) ? `"${family}", monospace` : 'monospace';
}

function paint(palette) {
  const m = T.createMapper(palette);
  const root = document.documentElement.style;
  // Light glasses on a light theme, dark glasses otherwise.
  $('logo').src = `../icons/omareader-${palette.mode === 'light' ? 'light' : 'dark'}.svg`;
  root.setProperty('--bg', palette.bg);
  root.setProperty('--fg', palette.fg);
  root.setProperty('--accent', palette.accent);
  root.setProperty('--muted', m.ramp(0.55));
  root.setProperty('--line', m.ramp(0.14));
  root.setProperty('--field', m.ramp(0.06));
  document.documentElement.style.colorScheme = palette.mode;
  const keys = ['bg', 'fg', 'accent', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'magenta'];
  $('swatches').replaceChildren(
    ...keys.filter((k) => palette[k]).map((k) => {
      const i = document.createElement('i');
      i.style.background = palette[k];
      i.title = k;
      return i;
    }),
  );
}

async function save() {
  await chrome.storage.local.set({ settings });
}

const check = (group, mode) => {
  for (const b of group.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
};

async function render() {
  const st = await chrome.storage.local.get(['settings', 'active', 'omarchy', 'host', 'font', 'darkReader']);
  settings = T.normalizeSettings(st.settings);
  const current = st.omarchy;
  // What the current tab shows: its own override, else the default.
  const mode = T.siteModeOf(settings, hostname);
  const own = hostname ? settings.sites[T.siteKey(hostname)] : undefined;

  check($('modes'), settings.mode);
  check($('siteModes'), own || 'default');
  $('site').textContent = hostname ? T.siteKey(hostname) : 'Not available on this page';
  $('siteKeys').hidden = !hostname;
  document.documentElement.style.setProperty('--font', fontStack(st.font));
  $('darkReader').hidden = st.darkReader !== 'seen';
  for (const b of $('siteModes').querySelectorAll('button')) b.disabled = !hostname;
  const def = $('siteModes').querySelector('[data-mode="default"]');
  def.title = `Use the mode for all sites (${LABELS[settings.mode]})`;
  $('swatches').hidden = mode === 'normal';

  if (mode === 'dark') paint(DARK);
  else if (st.active) paint(st.active.palette);

  const status = $('status');
  if (mode === 'normal') {
    status.textContent = 'Pages shown as they are';
  } else if (mode === 'dark') {
    status.textContent = 'Pitch black · page hues kept';
  } else if (declined) {
    status.textContent = 'Turn Dark Reader off in chrome://extensions';
  } else if (st.host && st.host.connected) {
    status.textContent = `Live sync · ${pretty(current && current.name)}`;
  } else {
    status.textContent = 'Native host offline · run install.sh ';
    const retry = document.createElement('button');
    retry.textContent = 'retry';
    retry.onclick = () => chrome.runtime.sendMessage({ type: 'reconnect' });
    status.append(retry);
  }
}

// Both rows are radio groups: click to pick, arrow keys to move like a native one.
function radioGroup(group, selected, pick) {
  const modes = () => [...group.querySelectorAll('button')].map((b) => b.dataset.mode);
  group.onclick = (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b && !b.disabled && b.dataset.mode !== selected()) pick(b.dataset.mode).then(save);
  };
  group.onkeydown = (e) => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || group.querySelector('button:disabled')) return;
    const list = modes();
    const i = list.indexOf(selected()) + (e.key === 'ArrowRight' ? 1 : -1);
    const next = list[(i + list.length) % list.length];
    pick(next).then(save).then(() => group.querySelector(`[data-mode="${next}"]`).focus());
  };
}

radioGroup($('modes'), () => settings.mode, async (mode) => {
  settings = T.withMode(settings, mode);
});
radioGroup($('siteModes'), () => (hostname && settings.sites[T.siteKey(hostname)]) || 'default', async (mode) => {
  if (hostname) settings = T.withSiteMode(settings, hostname, mode);
});

let declined = false;
$('darkReaderOff').onclick = async () => {
  let granted = false;
  try {
    granted = await chrome.permissions.request({ permissions: ['management'] });
  } catch {}
  if (!granted || !(await chrome.runtime.sendMessage({ type: 'dark-reader-off' }))) {
    declined = true;
    await chrome.storage.local.set({ darkReader: 'kept' });
  }
};
$('darkReaderKeep').onclick = () => chrome.storage.local.set({ darkReader: 'kept' });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') render();
});

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (/^https?:$/.test(url.protocol)) hostname = url.hostname;
  } catch {}
  render();
})();
