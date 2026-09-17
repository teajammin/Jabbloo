/**
 * Moves somebody else already wrote, for a player who has gone blank.
 *
 * A blank box and a clock is the hardest part of this game for anybody who is
 * not already in the mood, and "swing it at them" is what people fall back on
 * — which is the dullest move in the game and the lowest-scoring one.
 *
 * These exist to show the range rather than to be used: the point of reading
 * them is realising how far the writing is allowed to go. Every one of them
 * is a real move the choreographer can stage, so picking one is never a worse
 * outcome than the blank box it replaced.
 */

export interface Suggestion {
  /** Shown on the button — short enough to read at a glance. */
  label: string;
  /** What is actually submitted. */
  text: string;
}

export const SUGGESTIONS: Suggestion[] = [
  {
    label: 'Hypnotise them',
    text: 'swing it in slow circles until their eyes go funny, then make them '
      + 'punch their own face as hard as they can',
  },
  {
    label: 'Fall in love',
    text: 'make them fall hopelessly in love with me, wait for them to get '
      + 'close enough to propose, then headbutt them',
  },
  {
    label: 'Rapid fire',
    text: 'unload the entire thing into their chest, reload, and do it again '
      + 'while they are still falling over',
  },
  {
    label: 'Summon a piano',
    text: 'point dramatically at the sky until a grand piano arrives on their '
      + 'head, then bow to the audience',
  },
  {
    label: 'Fart, sincerely',
    text: 'turn around slowly, look them in the eye, and produce a fart so '
      + 'foul they are poisoned by it for the rest of the fight',
  },
  {
    label: 'Poison the blade',
    text: 'coat it in something green and unwise, open a small cut on their '
      + 'arm, then wait politely while it takes effect',
  },
  {
    label: 'Teleport behind',
    text: 'vanish, reappear directly behind them, tap them on the shoulder, '
      + 'and uppercut them when they turn round',
  },
  {
    label: 'Throw it. Hard.',
    text: 'hurl it at their head with everything I have and do not bother '
      + 'watching to see if it lands',
  },
  {
    label: 'Grow enormous',
    text: 'grow to three times my size, pick them up, and slam them into the '
      + 'ground like I am trying to start a lawnmower',
  },
  {
    label: 'Freeze them',
    text: 'freeze them solid from the feet up, then kick them over and watch '
      + 'them slide away',
  },
  {
    label: 'Set them alight',
    text: 'set the whole weapon on fire, swing it at their head, and leave '
      + 'them burning',
  },
  {
    label: 'Combo',
    text: 'uppercut, punch to the gut, shoot them in the leg, then bite their '
      + 'ear off while they are down',
  },
];

/**
 * A handful of them, different every round.
 *
 * All twelve at once is a wall of text under a clock, and the same three every
 * round stop being read after the first. Shuffled from a seed so everybody on
 * the same turn sees the same ones, which makes them something a room can talk
 * about rather than a private list.
 */
export function suggestionsFor(seed: number, count = 4): Suggestion[] {
  const pool = [...SUGGESTIONS];
  const picked: Suggestion[] = [];
  let next = Math.abs(Math.floor(seed)) + 1;

  while (picked.length < count && pool.length > 0) {
    // A small deterministic shuffle: enough to look arbitrary, and the same
    // for everybody given the same turn.
    next = (next * 1103515245 + 12345) & 0x7fffffff;
    picked.push(pool.splice(next % pool.length, 1)[0]!);
  }

  return picked;
}
