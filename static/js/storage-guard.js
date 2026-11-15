// Loaded first (app.js imports it before anything else). When the browser blocks site data,
// merely touching `localStorage` throws, and field.js reads it at the top level in a dozen
// places, so the module failed to load and the app came up blank (review #43). If storage
// is unusable, put an in-memory stand-in in its place: settings then last for this session
// only, and everything else works. Nothing changes when storage works.
(() => {
  try {
    const k = '__tf_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return;
  } catch (_) { /* blocked or full: fall through */ }
  const mem = new Map();
  const stand = {
    getItem: k => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => { mem.set(String(k), String(v)); },
    removeItem: k => { mem.delete(String(k)); },
    clear: () => mem.clear(),
    key: i => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: stand, configurable: true });
  } catch (_) { /* not replaceable here: callers' own try/catch is all that is left */ }
})();
