import { choreograph } from './choreographer';
import { judge } from './judge';
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
 * Whether a caller is allowed to spend a model call.
 *
 * Passed in rather than looked up, because only the deployed worker can ask
 * the room. In development there is nobody to guard against — the server is on
 * the same laptop as the person using it — so nothing is passed and every call
 * is allowed.
 */
export type Vouch = (room: string, device: string) => Promise<boolean>;

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
  vouch?: Vouch,
): Promise<ApiResult | null> {
  const config = readConfig(env);

  /** The two endpoints that cost money, and who may call them. */
  const allowed = async (): Promise<boolean> => {
    if (!vouch) return true;
    const room = typeof body['room'] === 'string' ? body['room'] : '';
    const device = typeof body['device'] === 'string' ? body['device'] : '';
    if (!room || !device) return false;
    return vouch(room, device);
  };

  switch (path) {
    case '/api/health':
      // Reports whether a key is configured, never the key itself.
      return {
        status: 200,
        body: {
          ok: true,
          keyConfigured: Boolean(config.apiKey),
          model: config.choreographer,
          fallback: config.choreographerFallback,
        },
      };

    case '/api/choreograph': {
      const fight = fightFrom(body);
      if (!fight.prompt) return { status: 400, body: { error: 'prompt required' } };
      if (!await allowed()) {
        return { status: 403, body: { error: 'not in a fight' } };
      }

      const result = await choreograph(fight, config);
      console.log(`[choreograph] ${result.source} - ${result.ms}ms "${fight.prompt.slice(0, 60)}"`);
      return {
        status: 200,
        body: { choreography: result.choreography, source: result.source, ms: result.ms },
      };
    }

    case '/api/judge': {
      const fight = fightFrom(body);
      if (!await allowed()) {
        return { status: 403, body: { error: 'not in a fight' } };
      }
      const verdict = await judge(fight, config);
      console.log(`[judge] ${verdict.score} (${verdict.source}) "${verdict.reason}"`);
      return { status: 200, body: verdict };
    }

    default:
      return null;
  }
}
