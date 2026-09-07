import { choreograph } from './choreographer';
import { judge } from './judge';
import { cutoutImage } from './cutout';
import { readConfig, type Env } from './ai';
import type { FightContext } from './prompt';

/**
 * The API, as one function.
 *
 * Paths and bodies in, status and JSON out — no Express types, no Request or
 * Response. That is what lets the same routes serve from the dev server and
 * from the deployed worker without either one being the odd copy that drifts.
 *
 * It also means the whole API can be tested by calling a function.
 */

const MAX_WORDS = 50;
const MAX_CHARS = 600;

function clampPrompt(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().split(/\s+/).slice(0, MAX_WORDS).join(' ').slice(0, MAX_CHARS);
}

function clampName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback;
}

function fightFrom(body: Record<string, unknown>): FightContext {
  return {
    prompt: clampPrompt(body['prompt']),
    characterName: clampName(body['characterName'], 'The fighter'),
    weaponName: clampName(body['weaponName'], 'their weapon'),
    enemyName: clampName(body['enemyName'], 'their opponent'),
  };
}

export interface ApiResult {
  status: number;
  body: unknown;
}

/**
 * Handles one API call, or returns null for a path this does not own.
 *
 * Null rather than a 404 so the caller can pass the request on to whatever
 * else it serves — static files, in the worker's case.
 */
export async function handleApi(
  path: string,
  body: Record<string, unknown>,
  env: Env,
): Promise<ApiResult | null> {
  const config = readConfig(env);

  switch (path) {
    case '/api/health':
      // Reports whether a key is configured, never the key itself.
      return {
        status: 200,
        body: {
          ok: true,
          keyConfigured: Boolean(config.apiKey),
          cutout: Boolean(config.removeBgKey),
          model: config.choreographer,
          fallback: config.choreographerFallback,
        },
      };

    case '/api/choreograph': {
      const fight = fightFrom(body);
      if (!fight.prompt) return { status: 400, body: { error: 'prompt required' } };

      const result = await choreograph(fight, config);
      console.log(`[choreograph] ${result.source} - ${result.ms}ms "${fight.prompt.slice(0, 60)}"`);
      return {
        status: 200,
        body: { choreography: result.choreography, source: result.source, ms: result.ms },
      };
    }

    case '/api/judge': {
      const fight = fightFrom(body);
      const verdict = await judge(fight, config);
      console.log(`[judge] ${verdict.score} (${verdict.source}) "${verdict.reason}"`);
      return { status: 200, body: verdict };
    }

    case '/api/cutout': {
      const result = await cutoutImage(body['image'], config.removeBgKey);
      return { status: result.status, body: result.body };
    }

    default:
      return null;
  }
}
