import { readFileSync } from 'node:fs';

/**
 * The battleground ids, read from the game rather than copied.
 *
 * These tests vote for specific grounds, and a hardcoded 'meadow' silently
 * became an invalid vote the day the battlegrounds changed — the room then sat
 * waiting out a timer it should have skipped, and four suites failed for a
 * reason none of them mentioned. Parsing the one definition keeps them honest.
 */
const source = readFileSync(new URL('../src/engine/theme.ts', import.meta.url), 'utf8');
const list = source.slice(source.indexOf('export const battlegrounds'));

export const GROUND_IDS = [...list.matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]);

if (GROUND_IDS.length < 2) {
  throw new Error('could not read the battleground ids from src/engine/theme.ts');
}
