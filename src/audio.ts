/**
 * Sound, synthesised rather than sampled.
 *
 * Every cue is a few oscillators and an envelope, which keeps the game at
 * zero audio assets — worth it for something that has to load over a phone
 * network in a living room, and it means a cue can be retuned in a line
 * rather than re-recorded.
 *
 * Browsers refuse to start audio before a gesture, so the context is created
 * on the first cue after one and stays silent until then rather than throwing.
 */

import { getSettings } from './settings';

export type Cue = 'click' | 'whoosh' | 'hit' | 'fanfare' | 'countdown';

let context: AudioContext | null = null;
let unlocked = false;

/** Called from a real user gesture; anything earlier is refused by the browser. */
export function unlockAudio(): void {
  unlocked = true;
  void context?.resume();
}

function ensureContext(): AudioContext | null {
  if (!unlocked) return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

/**
 * One note: an oscillator through a gain envelope.
 *
 * The envelope matters more than the waveform — a square wave with a hard
 * start is a beep, and the same wave with a 15 ms ramp is a click.
 */
function tone(
  ctx: AudioContext,
  options: {
    type: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    gain: number;
    delay?: number;
  },
): void {
  const start = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = options.type;
  osc.frequency.setValueAtTime(options.from, start);
  if (options.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), start + options.duration);
  }

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gain), start + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + options.duration + 0.05);
}

/** Filtered noise, for anything with air in it rather than a pitch. */
function noise(ctx: AudioContext, duration: number, gain: number, sweepTo = 400): void {
  const start = ctx.currentTime;
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1800, start);
  filter.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter).connect(amp).connect(ctx.destination);
  source.start(start);
}

/** Plays a cue, or does nothing if sound is off or not yet allowed. */
export function play(cue: Cue): void {
  const volume = getSettings().sfx;
  if (volume <= 0) return;
  const ctx = ensureContext();
  if (!ctx) return;

  switch (cue) {
    case 'click':
      tone(ctx, { type: 'triangle', from: 660, to: 880, duration: 0.07, gain: 0.16 * volume });
      break;
    case 'whoosh':
      noise(ctx, 0.28, 0.22 * volume, 300);
      break;
    case 'hit':
      tone(ctx, { type: 'square', from: 180, to: 60, duration: 0.22, gain: 0.3 * volume });
      noise(ctx, 0.16, 0.24 * volume, 200);
      break;
    case 'countdown':
      tone(ctx, { type: 'sine', from: 520, duration: 0.12, gain: 0.14 * volume });
      break;
    case 'fanfare':
      // A major triad walked upward — cheerful without needing a melody.
      [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => {
        tone(ctx, {
          type: 'triangle', from: hz, duration: 0.34,
          gain: 0.2 * volume, delay: i * 0.11,
        });
      });
      break;
  }
}

/** Frees the context, for a screen that is done with sound entirely. */
export function stopAudio(): void {
  void context?.close();
  context = null;
}
