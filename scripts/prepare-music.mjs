/**
 * Turns a dropped music file into something the game can loop.
 *
 * Three things are wrong with a track as downloaded. It is mastered at a
 * bitrate meant for listening rather than for sitting under a fight, so it
 * costs several megabytes the host has to fetch before anything can play. It
 * usually opens and closes on near-silence, which on a loop is a hole. And it
 * is louder than the sound effects it has to sit beneath.
 *
 * So: find where the music actually starts and stops, cut to that, and encode
 * at a bitrate that suits a background bed.
 *
 *   node scripts/prepare-music.mjs <in.mp3> <out-name>
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'music');

const [source, name] = process.argv.slice(2);
if (!source || !name) {
  console.error('usage: node scripts/prepare-music.mjs <in.mp3> <out-name>');
  process.exit(1);
}

/** Anything under this counts as silence, as a fraction of full scale. */
const FLOOR = 0.006;
/** Kept either side of the music, so it breathes rather than clipping in. */
const PAD_SECONDS = 0.02;
const BITRATE = 112;

/**
 * How much of the ending is folded back over the beginning.
 *
 * These are songs, not loops: they open at full volume and close on a fade to
 * nothing, so playing one end to end and starting it again is a stop and a
 * restart, which at a party is the moment everybody notices there is music.
 * Overlapping the tail onto the head turns a song into a loop — the fade-out
 * plays underneath the intro, and the join is continuous because the last
 * sample before the seam and the first sample after it are neighbours in the
 * original recording.
 */
const LOOP_OVERLAP_SECONDS = 4;

const work = mkdtempSync(join(tmpdir(), 'jabbloo-music-'));
const wav = join(work, 'decoded.wav');
const trimmed = join(work, 'trimmed.wav');

// afconvert rather than a library: it is on every Mac and reads whatever the
// download happened to be.
execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', source, wav]);

// --- find the music inside the file ----------------------------------------
const buf = readFileSync(wav);
// Walk the RIFF chunks rather than assuming a 44-byte header: afconvert emits
// a LIST chunk before the data, and reading from a fixed offset treats it as
// samples — which sounds like a click and moves every measurement along.
let at = 12;
let dataAt = -1;
let dataLength = 0;
let channels = 2;
let rate = 44100;
while (at + 8 <= buf.length) {
  const id = buf.toString('ascii', at, at + 4);
  const size = buf.readUInt32LE(at + 4);
  if (id === 'fmt ') {
    channels = buf.readUInt16LE(at + 10);
    rate = buf.readUInt32LE(at + 12);
  } else if (id === 'data') {
    dataAt = at + 8;
    dataLength = size;
    break;
  }
  at += 8 + size + (size % 2);
}
if (dataAt < 0) throw new Error('no data chunk in the decoded file');

const samples = Math.floor(dataLength / 2 / channels);
const peakAt = (frame) => {
  let peak = 0;
  for (let c = 0; c < channels; c++) {
    const value = Math.abs(buf.readInt16LE(dataAt + (frame * channels + c) * 2)) / 32768;
    if (value > peak) peak = value;
  }
  return peak;
};

let first = 0;
while (first < samples && peakAt(first) < FLOOR) first++;
let last = samples - 1;
while (last > first && peakAt(last) < FLOOR) last--;

const pad = Math.round(PAD_SECONDS * rate);
first = Math.max(0, first - pad);
last = Math.min(samples - 1, last + pad);

const kept = (last - first + 1);

/*
 * The tail, mixed down over the head.
 *
 * Equal-power rather than linear: two uncorrelated signals crossfaded on
 * straight lines dip in loudness through the middle of the fade, which is
 * audible as a sag every time round.
 */
const overlap = Math.min(
  Math.round(LOOP_OVERLAP_SECONDS * rate),
  Math.floor(kept / 3),
);
const looped = kept - overlap;
const audio = Buffer.alloc(looped * channels * 2);

const readAt = (frame, channel) =>
  buf.readInt16LE(dataAt + ((first + frame) * channels + channel) * 2);

for (let frame = 0; frame < looped; frame++) {
  for (let c = 0; c < channels; c++) {
    let value = readAt(frame, c);
    if (frame < overlap) {
      const t = frame / overlap;
      value = Math.round(
        value * Math.sqrt(t) + readAt(looped + frame, c) * Math.sqrt(1 - t),
      );
    }
    audio.writeInt16LE(Math.max(-32768, Math.min(32767, value)), (frame * channels + c) * 2);
  }
}

const head = Buffer.alloc(44);
head.write('RIFF', 0); head.writeUInt32LE(36 + looped * channels * 2, 4); head.write('WAVE', 8);
head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
head.writeUInt16LE(channels, 22); head.writeUInt32LE(rate, 24);
head.writeUInt32LE(rate * channels * 2, 28); head.writeUInt16LE(channels * 2, 32);
head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(looped * channels * 2, 40);
writeFileSync(trimmed, Buffer.concat([head, audio]));

// --- encode ----------------------------------------------------------------
const target = join(out, `${name}.mp3`);
execFileSync('lame', ['--quiet', '-b', String(BITRATE), '-q', '2', trimmed, target]);

const was = statSync(source).size;
const now = statSync(target).size;
console.log(
  `${name.padEnd(8)} ${(samples / rate).toFixed(1)}s → ${(looped / rate).toFixed(1)}s loop, `
  + `${(was / 1024 / 1024).toFixed(1)}MB → ${(now / 1024).toFixed(0)}KB `
  + `(cut ${(first / rate).toFixed(2)}s + ${((samples - 1 - last) / rate).toFixed(2)}s of silence, `
  + `${(overlap / rate).toFixed(1)}s of the ending folded over the start)`,
);

rmSync(work, { recursive: true, force: true });
