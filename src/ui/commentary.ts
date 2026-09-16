import type { Choreography } from '../engine';

/**
 * Turning a choreography into something worth saying out loud.
 *
 * The steps are the script: each one is a beat of the fight, so a line per
 * step lands with the movement it describes rather than summarising it
 * afterwards. Written short on purpose — a commentator talks over the action,
 * and a sentence that outlasts its own swing is a sentence arriving late.
 *
 * Phrased from the outside, the way somebody calling a fight would: names, not
 * "you", and the present tense throughout.
 */

type Step = { move?: string; on?: string; params?: Record<string, unknown> };

/** What to call each affliction when it is being announced. */
const AFFLICTIONS: Record<string, string> = {
  poison: 'poisoned',
  burn: 'burning',
  curse: 'cursed',
  love: 'head over heels',
  hypnotised: 'hypnotised',
  frozen: 'frozen solid',
  shocked: 'electrified',
  stink: 'gagging',
  confused: 'seeing stars',
  drunk: 'reeling',
};

/** What to call each thing that crosses the gap. */
const THROWN: Record<string, string> = {
  bullet: 'Shots fired',
  arrow: 'An arrow',
  fire: 'Fire',
  ice: 'Ice',
  sun: 'The sun itself',
  rock: 'A rock',
  heart: 'A heart',
  star: 'A star',
  poop: 'Oh, that is unpleasant',
  banana: 'A banana',
};

/**
 * One line per step, or an empty one where silence is better.
 *
 * Deliberately sparse: not every beat deserves a sentence, and a voice that
 * narrates the recoil and the settle as well as the blow is a voice nobody
 * wants at a party. The blanks are where it shuts up.
 */
export interface Beat {
  /** What the caption shows, with names, where there is time to read them. */
  caption: string;
  /** Which recording to play, if any. See src/shared/lines.ts. */
  line: string;
}

/**
 * The caption and the recording for each step.
 *
 * Two things rather than one because they can afford different amounts of
 * detail: the caption is read, so it can name people, and the recording is
 * shouted over an exchange, so it cannot — a fixed set of lines is what lets
 * the game sound the same in every room rather than depending on whatever
 * voice the host's laptop happens to have installed.
 */
export function describeBeats(
  choreography: Choreography,
  attacker: string,
  defender: string,
  weapon: string,
): Beat[] {
  const captions = describeSteps(choreography, attacker, defender, weapon);
  const steps = (choreography.steps ?? []) as Step[];

  return steps.map((step, index) => ({
    caption: captions[index] ?? '',
    line: lineFor(step, index),
  }));
}

/** Which recording a step calls for, or nothing where silence is better. */
function lineFor(step: Step, index: number): string {
  if (typeof step !== 'object' || step === null) return '';
  const move = step.move ?? '';
  const kind = typeof step.params?.['kind'] === 'string' ? String(step.params['kind']) : '';
  const style = typeof step.params?.['style'] === 'string' ? String(step.params['style']) : '';

  switch (move) {
    case 'charge': case 'dash': case 'move_to':
      return index === 0 ? 'closes' : '';
    case 'swing': return 'swing';
    case 'slam': return 'slam';
    case 'spin_weapon': return 'windup';
    case 'throw': return 'throw';
    case 'punch': return style === 'uppercut' ? 'uppercut' : 'punch';
    case 'kick': return 'kick';
    case 'headbutt': return 'headbutt';
    case 'bite': return 'bite';
    case 'grab': return 'grab';
    case 'stomp': return 'stomp';
    case 'projectile':
      return ['bullet', 'arrow', 'fire', 'ice', 'sun', 'rock'].includes(kind) ? kind : 'incoming';
    case 'beam': return 'beam';
    case 'shockwave': return kind === 'stink' ? 'stink' : 'shockwave';
    case 'summon': return 'summon';
    case 'sicken': return AFFLICTION_LINES[kind] ?? 'poisoned';
    case 'knockdown': return 'knockdown';
    case 'dizzy': return 'dizzy';
    case 'teleport': return 'teleport';
    case 'taunt': return 'taunt';
    case 'inhale': return 'inhale';
    case 'grow': return 'grow';
    case 'shrink': return 'shrink';
    case 'flip': case 'handspring': return 'flip';
    default: return '';
  }
}

/** Which recording each affliction gets. */
const AFFLICTION_LINES: Record<string, string> = {
  poison: 'poisoned',
  burn: 'burning',
  curse: 'cursed',
  love: 'love',
  hypnotised: 'hypnotised',
  frozen: 'frozen',
  shocked: 'shocked',
  stink: 'stink',
  confused: 'confused',
  drunk: 'drunk',
};

export function describeSteps(
  choreography: Choreography,
  attacker: string,
  defender: string,
  weapon: string,
): string[] {
  const steps = (choreography.steps ?? []) as Step[];

  return steps.map((step, index) => {
    // These arrive from a model by way of a parser, and a line of commentary
    // is not worth taking a fight down for.
    if (typeof step !== 'object' || step === null) return '';
    const move = step.move ?? '';
    const kind = typeof step.params?.['kind'] === 'string'
      ? String(step.params['kind'])
      : '';
    const first = index === 0;

    switch (move) {
      case 'charge':
      case 'dash':
      case 'move_to':
        return first ? `${attacker} closes in!` : '';

      case 'swing':
        return `${attacker} swings the ${weapon}!`;
      case 'slam':
        return `${attacker} brings it down hard!`;
      case 'spin_weapon':
        return `${attacker} winds up!`;
      case 'throw':
        return `${attacker} hurls the ${weapon}!`;

      case 'punch':
        return step.params?.['style'] === 'uppercut'
          ? `Uppercut!`
          : `${attacker} lets the hands go!`;
      case 'kick':
        return `A kick!`;
      case 'headbutt':
        return `Headbutt!`;
      case 'bite':
        return `${attacker} bites!`;
      case 'grab':
        return `${attacker} grabs hold!`;
      case 'stomp':
        return `Stomped!`;

      case 'projectile':
        return `${THROWN[kind] ?? 'Incoming'}!`;
      case 'beam':
        return `${attacker} lets it rip!`;
      case 'shockwave':
        return kind === 'stink' ? `Oh no.` : `The whole arena shakes!`;
      case 'summon':
        return `Something is falling!`;

      case 'sicken':
        return `${defender} is ${AFFLICTIONS[kind] ?? 'in a bad way'}!`;
      case 'knockdown':
        return `${defender} goes down!`;
      case 'dizzy':
        return `${defender} does not know where they are!`;

      case 'teleport':
        return `${attacker} vanishes!`;
      case 'taunt':
        return `${attacker} is showing off.`;
      case 'inhale':
        return `${attacker} takes a deep breath…`;
      case 'grow':
        return `${attacker} is getting bigger!`;
      case 'shrink':
        return `${attacker} is shrinking!`;
      case 'flip':
      case 'handspring':
        return `${attacker} flips!`;

      // Screen shake, recoil, idle: the picture says it better than a voice.
      default:
        return '';
    }
  });
}
