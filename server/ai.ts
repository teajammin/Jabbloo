import Anthropic from '@anthropic-ai/sdk';

/**
 * Model configuration, read from an environment rather than *the* environment.
 *
 * The same AI code runs in two places: the Express server during development,
 * and the PartyKit worker in production. A Cloudflare worker has no
 * `process.env` — its variables arrive as an object — so nothing here may read
 * the environment at import time. That one rule is why this file exists.
 */

export interface AiConfig {
  apiKey: string;
  choreographer: string;
  choreographerFallback: string;
  judge: string;
  removeBgKey: string;
}

/** An environment as either runtime hands it over. */
export type Env = Record<string, unknown>;

const text = (env: Env, key: string, fallback = ''): string => {
  const value = env[key];
  return typeof value === 'string' && value ? value : fallback;
};

export function readConfig(env: Env): AiConfig {
  return {
    apiKey: text(env, 'ANTHROPIC_API_KEY'),
    choreographer: text(env, 'CHOREOGRAPHER_MODEL', 'claude-haiku-4-5'),
    choreographerFallback: text(env, 'CHOREOGRAPHER_FALLBACK_MODEL', 'claude-sonnet-5'),
    judge: text(env, 'JUDGE_MODEL', 'claude-sonnet-5'),
    removeBgKey: text(env, 'REMOVEBG_API_KEY'),
  };
}

/**
 * One client per key.
 *
 * Constructing an Anthropic client per request would rebuild its fetch plumbing
 * on every move in the game; there is only ever one key, so one client.
 */
const clients = new Map<string, Anthropic>();

export function clientFor(config: AiConfig): Anthropic {
  const existing = clients.get(config.apiKey);
  if (existing) return existing;
  const client = new Anthropic({ apiKey: config.apiKey });
  clients.set(config.apiKey, client);
  return client;
}
