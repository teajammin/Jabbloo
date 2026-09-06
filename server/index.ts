import 'dotenv/config';
import express from 'express';
import { choreograph } from './choreographer';
import { cutout, cutoutAvailable } from './cutout';
import type { FightContext } from './prompt';

/**
 * Choreographer backend.
 *
 * Exists solely so the Anthropic API key stays server-side — it must never
 * reach the browser. Deliberately thin: no game state, no rooms, no scoring.
 * Those belong to the multiplayer layer, which is a separate section.
 */

const app = express();
// Choreography prompts are tiny; uploaded images are not.
app.use(express.json({ limit: '16mb' }));

const PORT = Number(process.env.PORT ?? 8787);

/** The brief's cap on how much a player may write. */
const MAX_WORDS = 50;
const MAX_CHARS = 600;

function clampPrompt(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().split(/\s+/).slice(0, MAX_WORDS).join(' ').slice(0, MAX_CHARS);
}

function clampName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback;
}

app.get('/api/health', (_req, res) => {
  // Reports whether a key is configured, never the key itself.
  res.json({
    ok: true,
    keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    cutout: cutoutAvailable(),
    model: process.env.CHOREOGRAPHER_MODEL ?? 'claude-haiku-4-5',
    fallback: process.env.CHOREOGRAPHER_FALLBACK_MODEL ?? 'claude-sonnet-5',
  });
});

app.post('/api/choreograph', async (req, res) => {
  const prompt = clampPrompt(req.body?.prompt);
  if (!prompt) {
    res.status(400).json({ error: 'prompt required' });
    return;
  }

  const fight: FightContext = {
    prompt,
    characterName: clampName(req.body?.characterName, 'The fighter'),
    weaponName: clampName(req.body?.weaponName, 'their weapon'),
    enemyName: clampName(req.body?.enemyName, 'their opponent'),
  };

  const result = await choreograph(fight);

  console.log(
    `[choreograph] ${result.source} ${result.model ?? '-'} ${result.ms}ms "${prompt.slice(0, 60)}"`,
  );

  // Always 200: a failed choreography is a gameplay outcome (the default bonk),
  // not an HTTP error. The client should never have to handle a fight crashing.
  res.json({
    choreography: result.choreography,
    source: result.source,
    ms: result.ms,
  });
});

app.post('/api/cutout', cutout);

app.listen(PORT, () => {
  const keyed = process.env.ANTHROPIC_API_KEY ? 'key loaded' : 'NO KEY — set ANTHROPIC_API_KEY in .env';
  console.log(`Choreographer listening on http://localhost:${PORT} (${keyed})`);
});
