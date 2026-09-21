/**
 * The music bed.
 *
 * Two tracks: one for a fight, one for everything else. They cross-fade, they
 * loop, and they get out of the way when the narrator speaks.
 *
 * Played through Web Audio rather than an <audio loop>, because an MP3 cannot
 * loop cleanly: the format pads both ends of the file with silence the encoder
 * needs and the decoder is supposed to drop, and browsers disagree about how
 * much of it to drop. The result is a gap at the seam — small, but on a
 * sixty-second loop at a party it arrives often enough to notice. Decoded into
 * a buffer once, the seam is exact.
 *
 * Only ever on the big screen. Seven devices playing the same track, each a
 * fraction of a second out from the others, is not music.
 */

import { audioContext, whenAudioUnlocked } from './audio';
import { getSettings, onSettingsChange } from './settings';

export type Track = 'theme' | 'battle';

const SOURCES: Record<Track, string> = {
  theme: '/music/theme.mp3',
  battle: '/music/battle.mp3',
};

/** How long one track takes to become the other. */
const CROSSFADE = 1.4;

/** What the bed drops to while something is being said over it. */
const DUCKED = 0.32;

/**
 * How loud the music is against everything else.
 *
 * The slider runs to one and the tracks are mastered for listening to, not
 * for sitting underneath a fight — at full slider they buried both the
 * effects and the voice reading out what somebody wrote.
 */
const CEILING = 0.34;

interface Playing {
  track: Track;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const buffers = new Map<Track, AudioBuffer>();
const loading = new Map<Track, Promise<AudioBuffer | null>>();

let enabled = false;
let wanted: Track | null = null;
let playing: Playing | null = null;
let ducked = false;

/**
 * Turns the music on for this device.
 *
 * Off until something says otherwise, so a phone that never calls this stays
 * silent however many screens ask for a track.
 */
export function enableMusic(): void {
  enabled = true;
  if (wanted) void start(wanted);
}

/** Loads and decodes a track, once, whatever asks for it. */
async function bufferFor(track: Track): Promise<AudioBuffer | null> {
  const already = buffers.get(track);
  if (already) return already;

  const inFlight = loading.get(track);
  if (inFlight) return inFlight;

  const work = (async () => {
    const ctx = audioContext();
    if (!ctx) return null;
    try {
      const response = await fetch(SOURCES[track]);
      if (!response.ok) return null;
      const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
      buffers.set(track, decoded);
      return decoded;
    } catch {
      // A missing or unplayable track is a quieter game, not a broken one.
      return null;
    } finally {
      loading.delete(track);
    }
  })();

  loading.set(track, work);
  return work;
}

/** What the bed should be at right now, slider and ducking together. */
function level(): number {
  return getSettings().music * CEILING * (ducked ? DUCKED : 1);
}

async function start(track: Track): Promise<void> {
  const ctx = audioContext();
  if (!ctx || !enabled) return;

  const buffer = await bufferFor(track);
  // Asked for something else while this was decoding — a fight that started
  // and finished inside the download is not a reason to start fight music.
  if (!buffer || !enabled || wanted !== track) return;
  if (playing?.track === track) return;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(level(), ctx.currentTime + CROSSFADE);
  gain.connect(ctx.destination);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  source.start();

  fadeOut(playing);
  playing = { track, source, gain };
}

/** Takes a track down over the cross-fade and disposes of it afterwards. */
function fadeOut(previous: Playing | null): void {
  if (!previous) return;
  const ctx = audioContext();
  if (!ctx) return;

  previous.gain.gain.cancelScheduledValues(ctx.currentTime);
  previous.gain.gain.setValueAtTime(previous.gain.gain.value, ctx.currentTime);
  previous.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + CROSSFADE);
  // Stopped rather than left running silently: a looping source with no
  // volume is still decoding audio for as long as the page is open.
  previous.source.stop(ctx.currentTime + CROSSFADE + 0.1);
  previous.source.onended = () => {
    previous.source.disconnect();
    previous.gain.disconnect();
  };
}

/**
 * Asks for a track, or for silence.
 *
 * Safe to call with what is already playing, and safe to call before the
 * browser has allowed any sound at all — the request is remembered and
 * honoured at the first tap.
 */
export function setTrack(track: Track | null): void {
  if (wanted === track) return;
  wanted = track;

  if (track === null) {
    fadeOut(playing);
    playing = null;
    return;
  }

  whenAudioUnlocked(() => {
    // Checked again inside: the tap that unlocked sound may have arrived
    // several screens after the one that asked for this.
    if (wanted === track) void start(track);
  });
}

/**
 * Drops the bed while something is spoken over it.
 *
 * The narrator reads out what a player wrote, which is the best thing in the
 * round; music at full level under it turns fifty words somebody laboured
 * over into mumbling.
 */
export function duckMusic(on: boolean): void {
  if (ducked === on) return;
  ducked = on;
  applyLevel(0.35);
}

function applyLevel(seconds: number): void {
  const ctx = audioContext();
  if (!ctx || !playing) return;
  playing.gain.gain.cancelScheduledValues(ctx.currentTime);
  playing.gain.gain.setValueAtTime(playing.gain.gain.value, ctx.currentTime);
  playing.gain.gain.linearRampToValueAtTime(level(), ctx.currentTime + seconds);
}

// The slider moves while a track is playing, and should be heard doing it.
onSettingsChange(() => applyLevel(0.12));
