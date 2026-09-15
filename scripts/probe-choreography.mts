/**
 * Asks the choreographer for a few moves and prints what it came back with.
 *
 * For the questions the tests cannot answer — whether a gun actually fires,
 * whether a fart makes a cloud, whether a ranged attack keeps its distance —
 * where the only real check is what the model does with a real prompt. Costs
 * a fraction of a cent a run, so it is a script rather than a test.
 *
 *   npx tsx scripts/probe-choreography.mts
 */
import '../server/env';
import { choreograph } from '../server/choreographer';
import { readConfig } from '../server/ai';

const cases = [
  { prompt: 'shoot the other player', weaponName: 'Gun' },
  { prompt: 'blast them point blank', weaponName: 'Shotgun' },
  { prompt: 'fire an arrow through their hat', weaponName: 'Bow' },
  { prompt: 'throw it at their head as hard as i can', weaponName: 'Axe' },
  { prompt: 'fart in their general direction', weaponName: 'Beans' },
  { prompt: 'swing it at their head', weaponName: 'Butter Sword' },
  { prompt: 'poison them with the blade so they rot', weaponName: 'Dagger' },
  { prompt: 'shoot them right in the heart', weaponName: 'Gun' },
  { prompt: 'shoot them in the knee', weaponName: 'Gun' },
];

/** Moves that close the distance — wrong in front of a ranged attack. */
const APPROACH = new Set(['move_to', 'dash', 'step', 'charge', 'lunge']);
const RANGED = new Set(['projectile', 'beam', 'shockwave', 'throw', 'summon']);

const config = readConfig(process.env);

for (const one of cases) {
  const { choreography } = await choreograph({
    prompt: one.prompt,
    characterName: 'Ann',
    weaponName: one.weaponName,
    enemyName: 'Bo',
  }, config);

  const steps = (choreography.steps ?? []) as {
    move?: string; on?: string; params?: Record<string, unknown>;
  }[];

  const names = steps.map((s) => s.move ?? '?');
  const summary = steps.map((s) => {
    const kind = s.params?.['kind'];
    return (s.move ?? '?') + (kind ? `:${String(kind)}` : '') + (s.on === 'enemy' ? '(enemy)' : '');
  }).join(' → ');

  // An approach before a ranged move is the thing that makes shooting look
  // like hitting.
  const firstRanged = names.findIndex((n) => RANGED.has(n));
  const closedIn = firstRanged >= 0 && names.slice(0, firstRanged).some((n) => APPROACH.has(n));

  console.log(`${one.weaponName.padEnd(14)} "${one.prompt}"`);
  console.log(`  ${summary}`);
  if (closedIn) console.log('  !! walked in before a ranged attack');
  if (firstRanged < 0 && /shoot|fire|throw|fart|blast/i.test(one.prompt)) {
    console.log('  !! nothing crossed the gap');
  }
  console.log();
}
