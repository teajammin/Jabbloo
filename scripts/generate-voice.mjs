/**
 * Records the narrator, once, into files the site ships with.
 *
 * The alternative was speaking through whatever voice the host laptop had
 * installed, which made the game sound different in every room — and silent in
 * some. Recording the lines makes the voice part of the game rather than part
 * of somebody's machine.
 *
 * Uses macOS `say` and `afconvert`, both built in, so this needs no key and no
 * network. Swapping in a better engine later means changing only this file:
 * the game asks for `/vo/<id>.m4a` and does not care what made it.
 *
 *   npm run gen:voice
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'public', 'vo');

// Read the line list out of the shared source, so this and the game can never
// disagree about what exists.
const { readFileSync } = await import('node:fs');
const source = readFileSync(join(root, 'src', 'shared', 'lines.ts'), 'utf8');
const lines = [...source.matchAll(/\{ id: '([^']+)', text: (?:'([^']*)'|"([^"]*)") \}/g)]
  .map((m) => ({ id: m[1], text: m[2] ?? m[3] }));

if (lines.length < 10) {
  throw new Error(`only found ${lines.length} lines in src/shared/lines.ts`);
}

/*
 * The voice, and why it is pitched down.
 *
 * `say` takes embedded commands: pbas is the baseline pitch, and dropping it
 * turns a flat reading voice into something with a chest behind it. Ralph is
 * the deepest thing every Mac has, so the recording sounds the same whether or
 * not the machine that made it had the good voices installed.
 */
const VOICE = process.env['VO_VOICE'] ?? 'Ralph';
const PITCH = process.env['VO_PITCH'] ?? '34';
const RATE = process.env['VO_RATE'] ?? '150';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let bytes = 0;
for (const { id, text } of lines) {
  const aiff = join(out, `${id}.aiff`);
  const mp3 = join(out, `${id}.mp3`);

  execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', aiff, `[[pbas ${PITCH}]] ${text}`]);
  /*
   * MP3, not AAC.
   *
   * The static host serves what it recognises, and an .m4a came back 404 from
   * the deployed site while every .png beside it was fine. MP3 is the format
   * nothing has ever failed to know, which is the only property that matters
   * for a file whose whole job is to exist when asked for.
   *
   * 48kbps mono is plenty for a shout over sound effects, and keeps the set
   * small enough that nobody waits for it.
   */
  execFileSync('lame', ['--quiet', '-m', 'm', '-b', '48', '--resample', '22.05', aiff, mp3]);
  rmSync(aiff);
  bytes += statSync(mp3).size;
}

console.log(`recorded ${lines.length} lines as ${VOICE}`);
console.log(`${readdirSync(out).length} files, ${(bytes / 1024).toFixed(0)}KB total`);
