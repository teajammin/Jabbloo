import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildUserMessage, type FightContext } from './prompt';

/**
 * Turns a player's prompt into choreography JSON via Claude.
 *
 * Haiku first for speed and cost, Sonnet as the fallback — per the brief.
 * Every failure path degrades rather than throwing: the client's parser
 * substitutes the default bonk for anything unusable, so a player always sees
 * a fight.
 */

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const PRIMARY = process.env.CHOREOGRAPHER_MODEL ?? 'claude-haiku-4-5';
const FALLBACK = process.env.CHOREOGRAPHER_FALLBACK_MODEL ?? 'claude-sonnet-5';

/** Choreographies are small; this is generous. */
const MAX_TOKENS = 1024;

export type ChoreographySource = 'primary' | 'fallback' | 'default';

export interface ChoreographyResult {
  /** Parsed JSON, or null when both models failed. */
  choreography: unknown;
  source: ChoreographySource;
  model: string | null;
  ms: number;
  /** Populated when something went wrong, for logging — never shown to players. */
  error?: string;
}

/**
 * Pulls a JSON object out of a model response.
 *
 * Models wrap JSON in prose or markdown fences despite instructions not to, so
 * this finds the outermost braces rather than trusting the whole string to
 * parse. Returns null if there is nothing usable.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to brace-scanning.
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Concatenates the text blocks of a response. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function callModel(model: string, fight: FightContext): Promise<unknown> {
  const message = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        // The prompt is identical on every request, so cache it: the per-fight
        // details live in the user message, after this breakpoint.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserMessage(fight) }],
  });

  if (message.stop_reason === 'refusal') {
    throw new Error(`refused: ${message.stop_details?.category ?? 'unknown'}`);
  }

  const parsed = extractJson(textOf(message));
  if (parsed === null) throw new Error('no JSON in response');
  return parsed;
}

export async function choreograph(fight: FightContext): Promise<ChoreographyResult> {
  const started = Date.now();

  try {
    const choreography = await callModel(PRIMARY, fight);
    return { choreography, source: 'primary', model: PRIMARY, ms: Date.now() - started };
  } catch (primaryError) {
    const primaryMessage = describe(primaryError);
    console.warn(`[choreographer] ${PRIMARY} failed: ${primaryMessage}`);

    try {
      const choreography = await callModel(FALLBACK, fight);
      return {
        choreography,
        source: 'fallback',
        model: FALLBACK,
        ms: Date.now() - started,
        error: primaryMessage,
      };
    } catch (fallbackError) {
      const fallbackMessage = describe(fallbackError);
      console.error(`[choreographer] ${FALLBACK} failed: ${fallbackMessage}`);
      // Null, not an exception: the client turns this into the default bonk.
      return {
        choreography: null,
        source: 'default',
        model: null,
        ms: Date.now() - started,
        error: `${primaryMessage}; ${fallbackMessage}`,
      };
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `${error.status} ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
