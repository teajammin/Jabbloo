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

    /*
     * Whatever broke on somebody's phone.
     *
     * Deliberately outside the vouching: an error happens when the game is in
     * a bad state, which is exactly when a device cannot prove it belongs to a
     * fight. It spends nothing, so the worst a stranger can do is write a line
     * in a log. What it accepts is capped for the same reason.
     */
    case '/api/log': {
      const text = (key: string, max: number): string =>
        typeof body[key] === 'string' ? (body[key] as string).slice(0, max) : '';

      const message = text('message', 300);
      if (!message) return { status: 400, body: { error: 'message required' } };

      const where = [text('screen', 40), text('room', 8), text('version', 20)]
        .filter(Boolean)
        .join(' · ');
      const times = Number(body['count']) > 1 ? ` (x${Number(body['count'])})` : '';

      // One line per report, so `npm run logs` reads as a list of what has
      // gone wrong rather than a wall of JSON.
      console.error(`[client] ${where}${times}: ${message}`);
      const stack = text('stack', 1200);
      if (stack) console.error(stack);
      const agent = text('agent', 200);
      if (agent) console.error(`  on ${agent}`);

      return { status: 202, body: { logged: true } };
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
