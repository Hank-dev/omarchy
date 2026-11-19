// Isolated-world orchestrator. Dark Reader's dynamic theme engine finds and rewrites every
// page color (stylesheets, inline styles, variables, shadow DOM, SVG); the Omarchy palette
// mapper picks each final color through the OmareaderSnap hook patched into the engine.
(() => {
  'use strict';
  const C = globalThis.OmareaderColor;
  const T = globalThis.OmareaderTheme;
  const K = globalThis.OmareaderContrast;
  const DR = globalThis.DarkReader;
  if (!(document instanceof HTMLDocument) || !DR) return;

  const extAlive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  };
  // After an extension reload/update the previous instance may still sit in this world;
  // a live one wins, a dead one is retired so it cannot keep painting a stale palette.
  const prior = globalThis.__omareader;
  if (prior && prior.alive()) return;
  if (prior) {
    try {
      prior.stop();
    } catch {}
  }
  globalThis.__omareader = { alive: extAlive, stop: () => stop() };

  // The per-site switch follows the top-level site, so embedded frames go with their page.
  const site = (() => {
    try {
      const origins = location.ancestorOrigins;
      if (origins && origins.length) return new URL(origins[origins.length - 1]).hostname;
      return location.hostname;
    } catch {
      return '';
    }
  })();

  // Dark Reader wraps chrome.runtime.sendMessage and drops its replies, so requests to the
  // worker use their own port: one question, one answer.
  function ask(name, question) {
    return new Promise((resolve) => {
      let port;
      try {
        port = chrome.runtime.connect({ name });
      } catch {
        resolve(null);
        return;
      }
      port.onMessage.addListener((answer) => {
        resolve(answer);
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        resolve(null);
      });
      port.postMessage(question);
    });
  }

  // Cross-origin stylesheets come through the worker, which fetches them without
  // credentials and refuses private addresses (see background.js).
  DR.setFetchMethod(async (url) => {
    const res = await ask('fetch-css', { url: String(url) });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not fetch stylesheet');
    return new Response(res.text, { status: 200, headers: { 'content-type': 'text/css' } });
  });

  let settings = null;
  let active = null;
  let fix;
  let fixAsked = false;
  let appliedKey = '';
  let mapper = null;

  const darkPalette = T.normalize(T.DARK);

  // The engine hands each page color here (rgb 0-255, alpha 0-1) with its role. Neutrals
  // land on the theme's ramp, saturated colors snap to the nearest theme hue.
  globalThis.OmareaderSnap = (rgb, role) => {
    if (!mapper) return null;
    try {
      return C.format(mapper.map({ r: rgb.r, g: rgb.g, b: rgb.b, a: rgb.a == null ? 1 : rgb.a }, role));
    } catch {
      return null;
    }
  };

  function themeFor(mode, palette) {
    const poles = K.readablePoles(palette.bg, palette.fg);
    const signature = mode === 'omarchy' ? JSON.stringify(palette) : '';
    return {
      mode: palette.mode === 'light' ? 0 : 1,
      brightness: 100,
      contrast: 100,
      grayscale: 0,
      sepia: 0,
      darkSchemeBackgroundColor: poles.background,
      darkSchemeTextColor: poles.foreground,
      lightSchemeBackgroundColor: poles.background,
      lightSchemeTextColor: poles.foreground,
      selectionColor: palette.selection_background || 'auto',
      styleSystemControls: true,
      omareaderPalette: signature,
    };
  }

  // Dark Reader's site fixes assume its own colors: fix CSS that would vanish into the
  // theme background takes the theme foreground instead.
  function themedFix(palette) {
    if (!fix || typeof fix !== 'object') return null;
    const poles = K.readablePoles(palette.bg, palette.fg);
    return {
      ...fix,
      css: typeof fix.css === 'string' ? K.repairFixColors(fix.css, poles.background, poles.foreground) : fix.css,
      invert: K.readableInvert(fix.invert, palette.mode),
    };
  }

  function stop() {
    mapper = null;
    if (!appliedKey) return;
    appliedKey = '';
    try {
      DR.disable();
    } catch {}
  }

  function evaluate() {
    if (!extAlive()) {
      stop();
      return;
    }
    const mode = T.siteModeOf(settings, site);
    const palette = mode === 'dark' ? darkPalette : active && active.palette;
    if (mode === 'normal' || !palette) {
      stop();
      return;
    }
    if (!fixAsked) {
      fixAsked = true;
      ask('site-fix', { url: location.href }).then((answer) => {
        fix = answer && answer.fix;
        evaluate();
      });
    }
    const key = JSON.stringify([mode, palette, fix || null]);
    if (key === appliedKey) return;
    // A color-only change takes Dark Reader's short path and leaves old paint in place,
    // so the engine is cleared before it starts again.
    if (appliedKey) DR.disable();
    appliedKey = key;
    // Dark keeps the page's own hues: Dark Reader's own colors on black, no mapper.
    mapper = mode === 'omarchy' ? T.createMapper(palette) : null;
    DR.enable(themeFor(mode, palette), themedFix(palette));
  }

  // The Dark Reader extension marks pages it themes. Two engines restyling the same page
  // fight, so the worker offers to turn it off.
  function watchDarkReaderExtension() {
    const root = document.documentElement;
    if (!root) return;
    const seen = () => root.getAttribute('data-darkreader-proxy-injected') === 'true';
    const report = () => {
      if (!seen()) return false;
      ask('dark-reader-seen', {});
      return true;
    };
    if (report()) return;
    const observer = new MutationObserver(() => {
      if (report()) observer.disconnect();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-darkreader-proxy-injected'] });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes.settings && !changes.active) return;
      if (changes.settings) settings = changes.settings.newValue;
      if (changes.active) active = changes.active.newValue;
      evaluate();
    });

    chrome.storage.local.get(['settings', 'active']).then(async (r) => {
      settings = r.settings;
      active = r.active;
      if (!active) {
        const state = await ask('get-state', {});
        if (state) {
          settings = state.settings;
          active = state.active;
        }
      }
      evaluate();
    });
  } catch {}

  watchDarkReaderExtension();
})();
