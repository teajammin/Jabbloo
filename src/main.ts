/**
 * Engine sandbox.
 *
 * A thin harness for eyeballing the engine during development — NOT part of the
 * engine itself, and not part of the real game. It imports only from
 * `./engine`, which keeps the module's public API honest: if something needed
 * here isn't exported there, the API is wrong.
 */

import gsap from 'gsap';
import { BattleStage, Fighter, battlegrounds, toCss, palette } from './engine';
import type { BattlegroundId } from './engine';

const parent = document.querySelector<HTMLElement>('#stage');
const controls = document.querySelector<HTMLElement>('#controls');
if (!parent || !controls) throw new Error('Sandbox markup missing');

const stage = new BattleStage({ parent, battleground: 'meadow' });

const [left, right] = await Promise.all([
  Fighter.create({
    name: 'Blobbo',
    weaponName: 'Butter Sword',
    character: '/placeholder-character-a.png',
    weapon: '/placeholder-weapon-sword.png',
  }),
  Fighter.create({
    name: 'Squish',
    weaponName: 'Grape Hammer',
    character: '/placeholder-character-b.png',
    weapon: '/placeholder-weapon-hammer.png',
  }),
]);

stage.addFighter(left, 'left');
stage.addFighter(right, 'right');

/**
 * A gentle breathing bob so the stage isn't dead still.
 *
 * Lives here rather than in the engine on purpose — the real `idle` primitive
 * arrives with the rest of the primitive library. This exists only to prove
 * GSAP is wired up and can drive the rig's containers.
 */
const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches;

if (!prefersReducedMotion) {
  for (const [index, fighter] of [left, right].entries()) {
    gsap.to(fighter.body, {
      y: -10,
      duration: 1.4,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      delay: index * 0.35, // offset so they don't bob in lockstep
    });
    gsap.to(fighter.hand, {
      rotation: 0.12,
      duration: 1.8,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      delay: index * 0.35,
    });
  }
}

// --- Battleground switcher -------------------------------------------------

let selected: BattlegroundId = 'meadow';

for (const ground of battlegrounds) {
  const button = document.createElement('button');
  button.textContent = ground.label;
  button.style.background = toCss(ground.colour);
  button.setAttribute('aria-pressed', String(ground.id === selected));

  button.addEventListener('click', () => {
    selected = ground.id;
    stage.setBattleground(ground.id);
    for (const other of controls.querySelectorAll('button')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
  });

  controls.appendChild(button);
}

// Flip both fighters on F, to sanity-check that mirroring keeps the hand anchor
// attached to the correct side of the body.
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'f') return;
  left.facing = left.facing === 'right' ? 'left' : 'right';
  right.facing = right.facing === 'right' ? 'left' : 'right';
});

console.log(
  `%cJabbloo engine sandbox ready`,
  `color:${toCss(palette.ink)};font-weight:bold`,
  '\n  F — flip fighters',
);
