/**
 * Engine sandbox.
 *
 * A workbench for developing the engine — NOT a screen in the game. It exists
 * so primitives and choreographies can be fired in isolation and tuned by eye.
 * It imports only from `./engine`, which keeps that module's public API honest:
 * anything needed here but not exported there means the API is wrong.
 */

import gsap from 'gsap';
import {
  BattleStage,
  BubbleText,
  Fighter,
  EFFECT_KINDS,
  preloadEffects,
  spawnEffect,
  battlegrounds,
  parseChoreography,
  playChoreography,
  toCss,
  palette,
  DEFAULT_CHOREOGRAPHY,
  MAX_CHOREOGRAPHY_SECONDS,
  type Choreography,
  type Playback,
  type PrimitiveContext,
  type Step,
} from './engine';
import type { BattlegroundId } from './engine';
import { requestChoreography } from './api';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Sandbox markup missing: ${sel}`);
  return el;
};

const stage = new BattleStage({ parent: $('#stage'), battleground: 'meadow' });

// Effects are preloaded so a move never has to await mid-timeline.
await preloadEffects();

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

const title = await BubbleText.create('JABBLOO', { height: 92, jitter: 5 });
title.x = (stage.width - title.width) / 2;
title.y = 128;
stage.overlay.addChild(title);

const ctx: PrimitiveContext = { actor: left, enemy: right, stage };
let playback: Playback | null = null;

const status = $<HTMLParagraphElement>('#status');

function play(choreography: Choreography): void {
  playback?.stop();
  playback = playChoreography(ctx, choreography, {
    onStep: (index, step) => {
      status.textContent = `${index + 1}/${choreography.steps.length}  ${step.move}`;
    },
  });

  const { requestedSeconds, actualSeconds, compressed } = playback;
  const summary = compressed
    ? `${requestedSeconds.toFixed(1)}s asked → compressed to ${actualSeconds.toFixed(1)}s`
    : `${actualSeconds.toFixed(1)}s`;

  playback.finished.then(() => {
    status.textContent = `done · ${summary}`;
  });
}

// --- Single primitives -----------------------------------------------------

const singles: { label: string; step: Step }[] = [
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

const moves = $('#moves');
for (const { label, step } of singles) {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', () => play({ steps: [step] }));
  moves.appendChild(button);
}

const resetButton = document.createElement('button');
resetButton.textContent = '↺ reset';
resetButton.className = 'ghost';
resetButton.addEventListener('click', () => {
  playback?.stop();
  stage.reset();
  status.textContent = 'reset';
});
moves.appendChild(resetButton);

// --- Choreography editor ---------------------------------------------------

const editor = $<HTMLTextAreaElement>('#choreography');

/**
 * Presets, including deliberately broken input. The malformed and overlong
 * cases matter most: they are what an AI actually produces on a bad day, and
 * the engine's handling of them is the thing worth watching.
 */
const presets: Record<string, unknown> = {
  'Sword combo': {
    steps: [
      { move: 'charge', params: { target: 'enemy', duration: 0.7 } },
      { move: 'swing', params: { direction: 'down', arc: 160, duration: 0.5 } },
      { move: 'shake_screen', params: { intensity: 6, duration: 0.3 } },
      { move: 'swing', params: { direction: 'up', arc: 120, duration: 0.5 } },
      { move: 'recoil', params: { distance: 70, duration: 0.5 } },
    ],
  },
  'Spin and throw': {
    steps: [
      { move: 'spin_weapon', params: { rotations: 3, duration: 0.9 } },
      { move: 'jump', params: { height: 150, forward: false, duration: 0.7 } },
      { move: 'throw', params: { target: 'enemy', returnAfter: true, duration: 1.4 } },
      { move: 'shake_screen', params: { intensity: 8, duration: 0.4 } },
    ],
  },
  'Overlong (tests 7s cap)': {
    steps: Array.from({ length: 8 }, () => ({
      move: 'slam',
      params: { direction: 'down', duration: 2.5 },
    })),
  },
  'Malformed (tests fallback)': {
    steps: [
      { move: 'teleport_behind_you', params: { style: 'anime' } },
      { move: 'summon_dragon' },
      'not even an object',
    ],
  },
  'Default bonk': DEFAULT_CHOREOGRAPHY,
};

const presetBar = $('#presets');
for (const [label, value] of Object.entries(presets)) {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = 'ghost';
  button.addEventListener('click', () => {
    editor.value = JSON.stringify(value, null, 2);
  });
  presetBar.appendChild(button);
}

editor.value = JSON.stringify(presets['Sword combo'], null, 2);

$('#play').addEventListener('click', () => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(editor.value);
  } catch {
    // Invalid JSON is itself a realistic AI failure — fall back, don't complain.
    status.textContent = 'invalid JSON → default bonk';
    play(DEFAULT_CHOREOGRAPHY);
    return;
  }

  const choreography = parseChoreography(parsed);
  const fellBack = choreography === DEFAULT_CHOREOGRAPHY;
  status.textContent = fellBack ? 'unusable → default bonk' : 'playing…';
  play(choreography);
});

// --- Toolkit preview (task 5) ----------------------------------------------
//
// Temporary scaffolding so the new effect sprites and limbs can be eyeballed
// before the moves that use them exist. Task 6 replaces this with real moves.

const toolkit = $('#toolkit');

for (const kind of EFFECT_KINDS) {
  const button = document.createElement('button');
  button.textContent = kind;
  button.className = 'ghost';
  button.addEventListener('click', () => {
    playback?.stop();
    stage.reset();
    const sprite = spawnEffect(stage.effects, kind, {
      x: stage.width / 2,
      y: stage.height * 0.55,
      height: 220,
    });
    gsap.fromTo(
      sprite,
      { alpha: 0 },
      { alpha: 1, duration: 0.15 },
    );
    gsap.fromTo(
      sprite.scale,
      { x: sprite.scale.x * 0.4, y: sprite.scale.y * 0.4 },
      { x: sprite.scale.x, y: sprite.scale.y, duration: 0.45, ease: 'back.out(2)' },
    );
    status.textContent = `effect: ${kind}`;
  });
  toolkit.appendChild(button);
}

const limbButton = document.createElement('button');
limbButton.textContent = '🦵 limb test';
limbButton.addEventListener('click', () => {
  playback?.stop();
  stage.reset();
  left.leg.show();
  left.arm.show();
  const legState = { angle: Math.PI / 2, length: 10 };
  const armState = { angle: Math.PI / 2, length: 10 };
  gsap.to(legState, {
    angle: 0.15, length: 130, duration: 0.35, ease: 'back.out(2.5)',
    onUpdate: () => left.leg.set(legState.angle, legState.length),
    yoyo: true, repeat: 1, repeatDelay: 0.5,
  });
  gsap.to(armState, {
    angle: -0.5, length: 95, duration: 0.3, ease: 'back.out(2.5)', delay: 0.15,
    onUpdate: () => left.arm.set(armState.angle, armState.length),
    yoyo: true, repeat: 1, repeatDelay: 0.4,
    onComplete: () => { left.leg.hide(); left.arm.hide(); },
  });
  status.textContent = 'limb rig: kick + punch';
});
toolkit.appendChild(limbButton);

// --- AI choreographer ------------------------------------------------------

const promptInput = $<HTMLInputElement>('#prompt');
const askButton = $<HTMLButtonElement>('#ask');

async function askAI(): Promise<void> {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  askButton.disabled = true;
  status.textContent = 'thinking…';

  const response = await requestChoreography({
    prompt,
    characterName: left.name,
    weaponName: left.weaponName,
    enemyName: right.name,
  });

  askButton.disabled = false;

  // Show what came back, so the JSON can be tweaked and replayed by hand.
  editor.value = JSON.stringify(response.choreography ?? DEFAULT_CHOREOGRAPHY, null, 2);

  const choreography = parseChoreography(response.choreography);
  const label =
    response.source === 'default'
      ? 'AI unavailable → default bonk'
      : `${response.source} · ${response.ms}ms`;
  status.textContent = label;
  play(choreography);
}

askButton.addEventListener('click', () => void askAI());
promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void askAI();
});

// --- Battlegrounds ---------------------------------------------------------

const grounds = $('#grounds');
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

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'f') return;
  left.facing = left.facing === 'right' ? 'left' : 'right';
  right.facing = right.facing === 'right' ? 'left' : 'right';
});

console.log(
  '%cJabbloo engine sandbox',
  `color:${toCss(palette.ink)};font-weight:bold`,
  `\n  ceiling: ${MAX_CHOREOGRAPHY_SECONDS}s · F flips fighters`,
);
