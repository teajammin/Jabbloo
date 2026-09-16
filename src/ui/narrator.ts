import { getSettings } from '../settings';

/**
 * The voice that calls the fight.
 *
 * Browser speech, deliberately: it starts in the same frame it is asked to,
 * which is the whole requirement — the commentary has to land on the movement
 * it is describing, and anything fetched over a network arrives a second or
 * two after the punch. It is also free, works with no connection, and costs
 * nothing per game.
 *
 * Only the big screen speaks. Six phones all narrating the same fight half a
 * second apart is a good way to clear a room.
 */

/** Presets, because a voice alone is not a character. */
export interface VoiceChoice {
  id: string;
  label: string;
  /** Voice names to look for, best first. */
  prefer: string[];
  pitch: number;
  rate: number;
}

/**
 * The voices worth offering, in the order they are tried.
 *
 * Named rather than picked by index because what is installed varies by
 * machine: a name that is missing simply falls through to the next, and the
 * last entry is whatever the browser calls its default.
 */
export const VOICES: VoiceChoice[] = [
  {
    id: 'announcer',
    label: 'Ring announcer',
    // The natural-sounding Apple voices first, if the machine has them — they
    // are free downloads and enormously better than the built-in set.
    prefer: ['Tom', 'Evan', 'Nathan', 'Aaron', 'Alex', 'Daniel', 'Ralph'],
    pitch: 0.7,
    rate: 0.98,
  },
  {
    id: 'arcade',
    label: 'Arcade cabinet',
    prefer: ['Fred', 'Ralph', 'Albert'],
    pitch: 0.6,
    rate: 0.92,
  },
  {
    id: 'hype',
    label: 'Hype man',
    prefer: ['Rocko', 'Reed', 'Eddy', 'Evan', 'Tom'],
    pitch: 0.8,
    rate: 1.08,
  },
  {
    id: 'default',
    label: 'Whatever this device has',
    prefer: [],
    pitch: 0.8,
    rate: 1,
  },
];

/** Whether this browser can speak at all. */
export function canNarrate(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Every English voice installed, best guess at quality first.
 *
 * The list arrives asynchronously in some browsers and synchronously in
 * others, which is why this waits for the event and also gives up on it.
 */
export async function availableVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!canNarrate()) return [];
  const ready = speechSynthesis.getVoices();
  if (ready.length > 0) return ready.filter((v) => v.lang.startsWith('en'));

  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')));
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1200);
  });
}

let chosen: SpeechSynthesisVoice | null = null;
let chosenFor = '';

/** The voice a preset actually resolves to on this machine. */
async function voiceFor(preset: VoiceChoice): Promise<SpeechSynthesisVoice | null> {
  if (chosen && chosenFor === preset.id) return chosen;
  const voices = await availableVoices();

  for (const wanted of preset.prefer) {
    const found = voices.find((v) => v.name.toLowerCase().startsWith(wanted.toLowerCase()));
    if (found) { chosen = found; chosenFor = preset.id; return found; }
  }

  chosen = voices.find((v) => v.default) ?? voices[0] ?? null;
  chosenFor = preset.id;
  return chosen;
}

function preset(): VoiceChoice {
  const wanted = getSettings().voice;
  return VOICES.find((v) => v.id === wanted) ?? VOICES[0]!;
}

/**
 * Says one line, cutting off whatever was being said.
 *
 * Cutting off is right for a fight: the commentary is describing what is on
 * screen now, and a queue would have it narrating the previous exchange over
 * this one. Resolves when the line finishes, so a caller can wait for it.
 */
export async function narrate(text: string): Promise<void> {
  if (!canNarrate() || !getSettings().narration) return;
  const line = text.trim();
  if (!line) return;

  const choice = preset();
  const voice = await voiceFor(choice);

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(line);
  if (voice) utterance.voice = voice;
  utterance.pitch = choice.pitch;
  utterance.rate = choice.rate;
  // Rides the effects volume: it is part of the fight, not the music bed.
  utterance.volume = Math.max(0.15, getSettings().sfx);

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    utterance.addEventListener('end', finish, { once: true });
    utterance.addEventListener('error', finish, { once: true });
    // A voice that never starts must not hold up a fight.
    setTimeout(finish, Math.max(2500, line.length * 90));
    speechSynthesis.speak(utterance);
  });
}

/** Stops mid-sentence — for leaving a screen, or a fight being cut short. */
export function hush(): void {
  if (canNarrate()) speechSynthesis.cancel();
}
