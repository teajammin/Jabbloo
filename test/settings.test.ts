/**
 * Settings tests.
 *
 * Settings are the one piece of app state that outlives a game, so what is
 * checked here is that they survive a bad store: a device with no
 * localStorage, or a stored blob that has been hand-edited into nonsense,
 * must still launch into a perfectly playable game.
 */
import { getSettings, loadSettings, updateSettings, onSettingsChange } from '../src/settings';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

/** A stand-in store, so the test does not depend on a browser. */
function useStore(store: Record<string, string> | null): void {
  const shim = store === null
    ? {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
      }
    : {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
      };
  (globalThis as { localStorage?: unknown }).localStorage = shim;
}

// A device that refuses storage entirely — private browsing, or a full disk.
useStore(null);
const denied = loadSettings();
check('a store that throws still yields settings', typeof denied.sfx === 'number');
check('and writing to it does not throw',
  updateSettings({ largeText: true }).largeText === true);

// Nonsense in the store must not leak into the game.
useStore({ 'jabbloo.settings': '{"music": "loud", "largeText": "yes please"}' });
const salvaged = loadSettings();
check('a non-numeric volume falls back', salvaged.music === 0.5, String(salvaged.music));
check('a truthy string still reads as on', salvaged.largeText === true);

useStore({ 'jabbloo.settings': 'not json at all' });
check('unparseable settings fall back to defaults', loadSettings().sfx === 0.8);

// Volumes are clamped rather than trusted.
useStore({ 'jabbloo.settings': '{"music": 4, "sfx": -2}' });
const clamped = loadSettings();
check('a volume above the range is clamped', clamped.music === 1, String(clamped.music));
check('and below it too', clamped.sfx === 0, String(clamped.sfx));

// Listeners are how the options menu and the engine stay in step.
const store: Record<string, string> = {};
useStore(store);
loadSettings();
let seen = 0;
const off = onSettingsChange(() => { seen++; });
updateSettings({ reduceMotion: true });
check('a change notifies listeners', seen === 1, String(seen));
check('and is readable straight back', getSettings().reduceMotion === true);
check('and is written to the store', store['jabbloo.settings']?.includes('"reduceMotion":true') === true);
off();
updateSettings({ reduceMotion: false });
check('an unsubscribed listener stops hearing', seen === 1, String(seen));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
