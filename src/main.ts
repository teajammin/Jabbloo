/**
 * Engine sandbox.
 *
 * A workbench for developing the engine — NOT a screen in the game. It exists
 * so each primitive can be fired in isolation and tuned by eye. It imports only
 * from `./engine`, which keeps that module's public API honest: anything needed
 * here but not exported there means the API is wrong.
 */

import gsap from 'gsap';
import {
  BattleStage,
  BubbleText,
  Fighter,
  battlegrounds,
  createStep,
  toCss,
  palette,
  type PrimitiveContext,
  type Step,
} from './engine';
import type { BattlegroundId } from './engine';

const parent = document.querySelector<HTMLElement>('#stage');
const grounds = document.querySelector<HTMLElement>('#grounds');
const moves = document.querySelector<HTMLElement>('#moves');
if (!parent || !grounds || !moves) throw new Error('Sandbox markup missing');

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

// The title, spelled from the artwork's own letters.
const title = await BubbleText.create('JABBLOO', { height: 96, jitter: 5 });
title.x = (stage.width - title.width) / 2;
title.y = 130;
stage.overlay.addChild(title);

// --- Firing primitives -----------------------------------------------------

const ctx: PrimitiveContext = { actor: left, enemy: right, stage };

/** Demo parameters chosen to show each move at its most legible. */
const demos: { label: string; step: Step }[] = [
  { label: 'move_to', step: { move: 'move_to', params: { x: 0.42, duration: 0.8 } } },
  { label: 'charge', step: { move: 'charge', params: { target: 'enemy', duration: 0.8 } } },
  { label: 'recoil', step: { move: 'recoil', params: { distance: 120, duration: 0.5 } } },
  { label: 'spin_weapon', step: { move: 'spin_weapon', params: { rotations: 2, duration: 0.8 } } },
  { label: 'swing', step: { move: 'swing', params: { direction: 'down', arc: 140, duration: 0.6 } } },
  { label: 'slam', step: { move: 'slam', params: { direction: 'down', duration: 0.8 } } },
  { label: 'throw', step: { move: 'throw', params: { target: 'enemy', returnAfter: true, duration: 1.2 } } },
  { label: 'jump', step: { move: 'jump', params: { height: 160, forward: true, duration: 0.9 } } },
  { label: 'shake_screen', step: { move: 'shake_screen', params: { intensity: 7, duration: 0.6 } } },
  { label: 'idle', step: { move: 'idle', params: { duration: 0.8 } } },
];

let running: gsap.core.Timeline | null = null;

/** Returns both fighters to their starting pose. */
function reset(): void {
  running?.kill();
  running = null;
  gsap.killTweensOf([
    left.root, left.body, left.hand, left.weapon,
    right.root, right.body, right.hand, right.weapon,
    stage.world,
  ]);

  left.reattachWeapon();
  right.reattachWeapon();

  for (const [fighter, side] of [[left, 'left'], [right, 'right']] as const) {
    fighter.body.position.set(0, 0);
    fighter.body.rotation = 0;
    fighter.body.scale.set(1, 1);
    fighter.hand.rotation = 0;
    stage.addFighter(fighter, side);
  }
  stage.world.position.set(0, 0);
}

function fire(step: Step): void {
  reset();
  running = createStep(ctx, step);
}

for (const demo of demos) {
  const button = document.createElement('button');
  button.textContent = demo.label;
  button.addEventListener('click', () => fire(demo.step));
  moves.appendChild(button);
}

const resetButton = document.createElement('button');
resetButton.textContent = '↺ reset';
resetButton.className = 'ghost';
resetButton.addEventListener('click', reset);
moves.appendChild(resetButton);

// --- Battleground switcher -------------------------------------------------

for (const ground of battlegrounds) {
  const button = document.createElement('button');
  button.textContent = ground.label;
  button.style.background = toCss(ground.colour);
  button.setAttribute('aria-pressed', String(ground.id === 'meadow'));

  button.addEventListener('click', () => {
    stage.setBattleground(ground.id as BattlegroundId);
    for (const other of grounds.querySelectorAll('button')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
  });

  grounds.appendChild(button);
}

// Flip both fighters, to check that mirroring keeps each weapon on the
// correct side of its body.
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'f') return;
  left.facing = left.facing === 'right' ? 'left' : 'right';
  right.facing = right.facing === 'right' ? 'left' : 'right';
});

console.log(
  '%cJabbloo engine sandbox',
  `color:${toCss(palette.ink)};font-weight:bold`,
  '\n  click a move to fire it · F flips fighters',
);
