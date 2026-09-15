/**
 * The body understands scaleX and scaleY.
 *
 * Thirty-nine tweens across the engine animate squash and stretch by those
 * names — the anticipation before a swing, the recoil after it, the wind-up on
 * a shout. Pixi objects have `scale.x`; `scaleX` belongs to a GSAP plugin that
 * is not registered here, so GSAP rejected every one of them as an unknown
 * property and none of them moved anything. The console said so, once, in a
 * warning nobody was reading.
 */
import { readFileSync } from 'node:fs';
import { Fighter } from '../src/engine/Fighter';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// A stand-in with the shape the accessors care about, so this needs no
// renderer: the point is the property, not the picture.
const view = { scale: { x: 1, y: 1 } };
const teach = (Fighter as unknown as {
  understandScale: (v: unknown) => void;
}).understandScale;

teach(view);
const box = view as unknown as { scaleX: number; scaleY: number };

check('scaleX reads the scale', box.scaleX === 1);
check('scaleY reads the scale', box.scaleY === 1);

box.scaleX = 1.18;
box.scaleY = 0.78;
check('setting scaleX moves scale.x', view.scale.x === 1.18, String(view.scale.x));
check('setting scaleY moves scale.y', view.scale.y === 0.78, String(view.scale.y));
check('and reads back what was set', box.scaleX === 1.18 && box.scaleY === 0.78);

// GSAP decides a property is animatable by looking it up on the target, so it
// has to be visibly there.
check('the property is discoverable', 'scaleX' in view && 'scaleY' in view);
check('and is not an own data property that a tween would clobber',
  Object.getOwnPropertyDescriptor(view, 'scaleX')?.get !== undefined);

// Teaching twice must not throw or replace working accessors.
teach(view);
box.scaleX = 2;
check('teaching an object twice is harmless', view.scale.x === 2, String(view.scale.x));

/*
 * The two lists that have to agree about who a reaction happens to.
 *
 * The server fills in `"on": "enemy"` for anything that describes a state
 * somebody is put into; the engine only honours it for moves on its own list.
 * `sicken` was added to the first and not the second, so every poisoning was
 * parsed back onto the attacker — the bug reported twice, and invisible in
 * both halves because each was individually correct.
 */
// From the working directory: these suites are bundled into a cache folder
// before they run, so a path relative to the source file points nowhere.
const enginePlayer = readFileSync(`${process.cwd()}/src/engine/player.ts`, 'utf8');
const serverDistance = readFileSync(`${process.cwd()}/server/distance.ts`, 'utf8');

const listed = (source: string, name: string): string[] => {
  const found = source.match(new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]`));
  return found ? [...found[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!) : [];
};

const engineSide = listed(enginePlayer, 'REACTION_MOVES');
const serverSide = listed(serverDistance, 'REACTIONS');

check('both lists were found', engineSide.length > 0 && serverSide.length > 0,
  JSON.stringify({ engineSide, serverSide }));
check('everything the server aims at the enemy is honoured by the engine',
  serverSide.every((move) => engineSide.includes(move)),
  JSON.stringify(serverSide.filter((m) => !engineSide.includes(m))));
check('poison is on both', engineSide.includes('sicken') && serverSide.includes('sicken'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
