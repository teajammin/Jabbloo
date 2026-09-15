import { readFileSync } from 'node:fs';

/**
 * Timing constants, read from the game rather than copied.
 *
 * A test that waits out a grace period has to wait out the *real* one. Copying
 * the number here would mean that changing it in the game turns these suites
 * into flaky ones — passing or failing on whether the machine was quick that
 * day — which is the least useful way for a test to break.
 */
const source = readFileSync(new URL('../src/shared/protocol.ts', import.meta.url), 'utf8');

function number(name) {
  const found = source.match(new RegExp(`export const ${name} = (\\d+)`));
  if (!found) throw new Error(`could not read ${name} from src/shared/protocol.ts`);
  return Number(found[1]);
}

export const GRACE_SECONDS = number('GRACE_SECONDS');
export const MOVE_SECONDS = number('MOVE_SECONDS');
export const WEAPON_COUNT = number('WEAPON_COUNT');
