import { duckMusic } from '../music';
import { getSettings } from '../settings';
import { LINES, lineUrl } from '../shared/lines';

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
    /*
     * Deep and steady, on whatever machine is hosting.
     *
     * Named across the three platforms rather than one: Apple's neural voices
     * first where they have been installed, then the built-in Mac voices that
     * are always present, then the Microsoft male voices every Windows
     * machine ships, then Chrome's own, then espeak on Linux. A room does not
     * pick its host laptop to suit a game's voice list.
     */
    prefer: [
      'Tom', 'Evan', 'Nathan', 'Aaron', 'Alex',        // macOS, downloaded
      'Daniel', 'Ralph',                               // macOS, always there
      'Microsoft David', 'Microsoft Mark', 'Microsoft Guy',
      'Microsoft Ryan', 'Microsoft Christopher', 'David', 'Mark',
      'Google UK English Male', 'Google US English',   // Chrome
      'English (Great Britain)', 'english-us',         // espeak
    ],
    pitch: 0.7,
    rate: 0.98,
  },
  {
    id: 'arcade',
    label: 'Arcade cabinet',
    // The buzzy retro one where it exists, and the deepest thing available
    // where it does not — the pitch below does most of the character anyway.
    prefer: [
      'Fred', 'Ralph', 'Albert',
      'Microsoft David', 'David', 'Google US English', 'english-us',
    ],
    pitch: 0.5,
    rate: 0.9,
  },
  {
    id: 'hype',
    label: 'Hype man',
    prefer: [
      'Rocko', 'Reed', 'Eddy', 'Evan', 'Tom',
      'Microsoft Guy', 'Microsoft Ryan', 'Microsoft Mark',
      'Google UK English Male', 'Google US English',
    ],
    pitch: 0.85,
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

/**
 * Names that usually belong to a male voice.
 *
 * A guess, and only used when a preset found none of the voices it asked for:
 * the alternative is the system default, which on a lot of Windows machines is
 * Zira and on a lot of phones is Samantha. Neither is what somebody choosing
 * "ring announcer" was after, and a wrong guess here costs nothing but a
 * slightly odd voice.
 */
const LIKELY_MALE = [
  'david', 'mark', 'guy', 'ryan', 'christopher', 'eric', 'james', 'george',
  'daniel', 'thomas', 'tom', 'alex', 'fred', 'ralph', 'male', 'man',
];

/**
 * Whether this device will actually say something.
 *
 * Different from `canNarrate`, which only asks whether the API exists: a bare
 * Linux box has the API and an empty voice list, and would silently say
 * nothing at all. Anything that depends on a line being heard — the move
 * description, which is no longer printed anywhere — has to ask this instead.
 */
export async function hasVoice(): Promise<boolean> {
  if (!canNarrate()) return false;
  return (await availableVoices()).length > 0;
}

/**
 * Whether this browser can speak at all.
 *
 * The API existing is not the same as a voice being installed — a bare Linux
 * box has the one and none of the other — but that cannot be known until the
 * list has loaded, so this is the cheap check and `narrate` handles an empty
 * list by simply staying quiet. Nothing is lost when it does: every line the
 * voice would say is already on screen as the caption.
 */
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

  // Nothing it asked for. Prefer something that at least sounds like the
  // character that was chosen, before falling back to whatever is default.
  if (preset.prefer.length > 0) {
    const masculine = voices.find((v) =>
      LIKELY_MALE.some((name) => v.name.toLowerCase().includes(name)));
    if (masculine) { chosen = masculine; chosenFor = preset.id; return masculine; }
  }

  chosen = voices.find((v) => v.default) ?? voices[0] ?? null;
  chosenFor = preset.id;
  return chosen;
}

function preset(): VoiceChoice {
  const wanted = getSettings().voice;
  return VOICES.find((v) => v.id === wanted) ?? VOICES[0]!;
}

/*
 * The game's own voice.
 *
 * Recorded once and shipped with the site, so the commentary sounds the same
 * in every room it is played in. The browser's own speech is still here, but
 * as the fallback rather than the plan: it is what reads a line that has a
 * player's name in it, which no recording can.
 */
const clips = new Map<string, HTMLAudioElement>();
let playing: HTMLAudioElement | null = null;

/**
 * Fetches every recording, so none of them arrives late to its own beat.
 *
 * Half a megabyte, once, while the arena is loading anyway — and after that
 * the commentary costs nothing and cannot be held up by the network.
 */
export function preloadLines(): void {
  if (typeof Audio === 'undefined' || clips.size > 0) return;
  for (const line of LINES) {
    const audio = new Audio(lineUrl(line.id));
    audio.preload = 'auto';
    clips.set(line.id, audio);
  }
}

/**
 * Plays one recorded line, cutting off whatever was playing.
 *
 * Cutting off is right for a fight: the commentary describes what is on screen
 * now, and a queue would have it calling the previous exchange over this one.
 */
export function say(id: string): void {
  if (!getSettings().narration || typeof Audio === 'undefined') return;

  const source = clips.get(id) ?? new Audio(lineUrl(id));
  clips.set(id, source);

  if (playing) {
    playing.pause();
    playing.currentTime = 0;
  }

  // A fresh element per play: the same one cannot overlap itself, and a
  // half-played clip that is asked to start again stutters.
  const clip = source.cloneNode() as HTMLAudioElement;
  clip.volume = Math.max(0.15, getSettings().sfx);
  playing = clip;
  /*
   * The music steps back for as long as this is speaking.
   *
   * Done here rather than at every call site, so anything that ever speaks
   * gets it without remembering to. A bed at full level under a voice reading
   * out the fifty words somebody wrote turns them into mumbling.
   */
  duckMusic(true);
  clip.addEventListener('ended', () => duckMusic(false), { once: true });
  // Autoplay rules, a missing file, a device with no output: none of them are
  // worth taking a fight down for.
  void clip.play().catch(() => { duckMusic(false); });
}

/** Stops the recording mid-word. */
function stopClip(): void {
  duckMusic(false);
  if (!playing) return;
  playing.pause();
  playing = null;
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
  // A machine with the API and no voices installed: say nothing rather than
  // queueing utterances that will never be spoken.
  if (!voice) return;

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(line);
  if (voice) utterance.voice = voice;
  utterance.pitch = choice.pitch;
  utterance.rate = choice.rate;
  // Rides the effects volume: it is part of the fight, not the music bed.
  utterance.volume = Math.max(0.15, getSettings().sfx);

  duckMusic(true);
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      // Whichever way this ended — finished, failed, or never started — the
      // music has to come back up, or one silent voice leaves it quiet for
      // the rest of the game.
      duckMusic(false);
      resolve();
    };
    utterance.addEventListener('end', finish, { once: true });
    utterance.addEventListener('error', finish, { once: true });
    // A voice that never starts must not hold up a fight.
    setTimeout(finish, Math.max(2500, line.length * 90));
    speechSynthesis.speak(utterance);
  });
}

/**
 * Which voice a preset lands on here, and nothing else.
 *
 * For tests: what a machine with a given set of voices installed would end up
 * being narrated by. The answer differs on every platform, which is exactly
 * why it is worth pinning down.
 */
export async function chosenVoiceName(presetId: string): Promise<string | null> {
  const choice = VOICES.find((v) => v.id === presetId) ?? VOICES[0]!;
  return (await voiceFor(choice))?.name ?? null;
}

/** Forgets the voice it settled on. For tests, and for a device that changes. */
export function resetNarrator(): void {
  chosen = null;
  chosenFor = '';
}

/** Stops mid-sentence — for leaving a screen, or a fight being cut short. */
export function hush(): void {
  duckMusic(false);
  stopClip();
  if (canNarrate()) speechSynthesis.cancel();
}
