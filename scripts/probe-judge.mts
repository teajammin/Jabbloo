/**
 * Asks the judge to score a few moves and prints what it gave them.
 *
 * The scoring rules are prose in a prompt, and prose is not self-checking:
 * whether a shot to the heart actually outscores a shot to the knee can only
 * be found out by asking. A handful of real calls, a fraction of a cent.
 *
 *   npx tsx scripts/probe-judge.mts
 */
import '../server/env';
import { judge } from '../server/judge';
import { readConfig } from '../server/ai';

const cases = [
  // The calibration the scale is written against.
  ['poop on opponent', 'Poop'],
  ['fart on opponent', 'Beans'],
  ['fire arrow at opponent', 'Bow'],
  ['shoot rapid fire to the chest', 'Rifle'],
  ["swing axe on opponent's neck", 'Axe'],
  ['uppercut, punch to gut, shoot leg with weapon, then bite', 'Gun'],
  ['shoot them right in the heart', 'Gun'],
  ['shoot them in the knee', 'Gun'],
  ['stab them through the throat', 'Dagger'],
  ['stab them in the foot', 'Dagger'],
  ['cut them and the blade is poisoned so they rot for days', 'Dagger'],
  ['cut them once with the blade', 'Dagger'],
  ['swing it at them', 'Butter Sword'],
] as const;

const config = readConfig(process.env);
const scores: Record<string, number> = {};

for (const [prompt, weaponName] of cases) {
  const verdict = await judge({
    prompt, characterName: 'Ann', weaponName, enemyName: 'Bo',
  }, config);
  scores[prompt] = verdict.score;
  console.log(`${String(verdict.score).padStart(2)}  "${prompt}"\n    ${verdict.reason}`);
}

const pair = (a: string, b: string, what: string) => {
  const gap = (scores[a] ?? 0) - (scores[b] ?? 0);
  console.log(`\n${what}: ${scores[a]} vs ${scores[b]}  ${gap > 0 ? `+${gap}` : gap}`);
};
pair('shoot them right in the heart', 'shoot them in the knee', 'heart over knee');
pair('stab them through the throat', 'stab them in the foot', 'throat over foot');
pair('cut them and the blade is poisoned so they rot for days',
  'cut them once with the blade', 'poisoned over plain');
