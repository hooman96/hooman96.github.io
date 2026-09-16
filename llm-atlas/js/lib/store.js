/** Minimal observable state store. */
export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      const changed = Object.keys(next).filter(k => next[k] !== state[k]);
      if (!changed.length) return;
      state = { ...state, ...next };
      for (const fn of subs) fn(state, changed);
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
