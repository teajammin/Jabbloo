/**
 * Every line the narrator can say, and its recording.
 *
 * The commentary used to be spoken by whatever voice the host's laptop had
 * installed, which meant the game sounded different in every room it was
 * played in — deep and gravelly on one machine, wrong-gendered on another, and
 * silent on a Linux box with an empty voice list. A party game should not
 * depend on what somebody happened to download.
 *
 * So the lines are fixed, recorded once, and shipped with the site. The cost
 * of that is that none of them can contain a name: players invent those, and a
 * recording cannot. It turns out not to matter — a commentator calling a fast
 * exchange says "Uppercut!", not "Sir Bonkalot delivers an uppercut" — and the
 * names are on screen in the caption anyway, where there is time to read them.
 *
 * Regenerate the audio with: npm run gen:voice
 */

export interface Line {
  /** File name, and the key the engine asks for. */
  id: string;
  /** What is said. Short: it has to finish inside the beat it belongs to. */
  text: string;
}

export const LINES: Line[] = [
  { id: 'ready', text: 'Weapons ready!' },
  { id: 'fight', text: 'Fight!' },
  { id: 'final', text: 'Final round! Every hit counts double!' },

  { id: 'closes', text: 'Closing in!' },
  { id: 'swing', text: 'Here comes the swing!' },
  { id: 'slam', text: 'Brought down hard!' },
  { id: 'windup', text: 'Winding up!' },
  { id: 'throw', text: "It's thrown!" },

  { id: 'punch', text: 'Hands going!' },
  { id: 'uppercut', text: 'Uppercut!' },
  { id: 'kick', text: 'A kick!' },
  { id: 'headbutt', text: 'Headbutt!' },
  { id: 'bite', text: 'A bite!' },
  { id: 'grab', text: 'Grabbed!' },
  { id: 'stomp', text: 'Stomped!' },

  { id: 'bullet', text: 'Shots fired!' },
  { id: 'arrow', text: 'An arrow!' },
  { id: 'fire', text: 'Fire!' },
  { id: 'ice', text: 'Ice!' },
  { id: 'sun', text: 'The sun itself!' },
  { id: 'rock', text: 'A rock!' },
  { id: 'incoming', text: 'Incoming!' },
  { id: 'beam', text: 'Letting it rip!' },
  { id: 'shockwave', text: 'The whole arena shakes!' },
  { id: 'stink', text: 'Oh, that is rank!' },
  { id: 'summon', text: "Something's falling!" },

  { id: 'poisoned', text: 'Poisoned!' },
  { id: 'burning', text: 'On fire!' },
  { id: 'cursed', text: 'Cursed!' },
  { id: 'love', text: 'Head over heels!' },
  { id: 'hypnotised', text: 'Hypnotised!' },
  { id: 'frozen', text: 'Frozen solid!' },
  { id: 'shocked', text: 'Electrified!' },
  { id: 'confused', text: 'Seeing stars!' },
  { id: 'drunk', text: 'Reeling!' },

  { id: 'knockdown', text: 'Down they go!' },
  { id: 'dizzy', text: 'No idea where they are!' },
  { id: 'teleport', text: 'Vanished!' },
  { id: 'taunt', text: 'Showing off!' },
  { id: 'inhale', text: 'Deep breath...' },
  { id: 'grow', text: 'Getting bigger!' },
  { id: 'shrink', text: 'Shrinking!' },
  { id: 'flip', text: 'A flip!' },
];

/** Where a recording lives, given its id. */
export function lineUrl(id: string): string {
  return `/vo/${id}.mp3`;
}
