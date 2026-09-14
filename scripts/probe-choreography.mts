/**
 * Asks the choreographer for a few moves and prints what it came back with.
 *
 * For questions the tests cannot answer — whether a gun actually fires, say —
 * where the only real check is what the model does with a real prompt. Costs
 * a few tenths of a cent a run, so it is a script rather than a test.
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
  { prompt: 'swing it at their head', weaponName: 'Butter Sword' },
];

const config = readConfig(process.env);

for (const one of cases) {
  const { choreography } = await choreograph({
    prompt: one.prompt,
    characterName: 'Ann',
    weaponName: one.weaponName,
    enemyName: 'Bo',
  }, config);

  const steps = (choreography.steps ?? []) as { type: string; params?: Record<string, unknown> }[];
  const summary = steps
    .map((s) => s.type + (s.params?.['kind'] ? `:${String(s.params['kind'])}` : ''))
    .join(' → ');
  console.log(`${one.weaponName.padEnd(14)} "${one.prompt}"\n  ${summary}\n`);
}
