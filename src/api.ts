/**
 * Client for the choreographer backend.
 *
 * Kept out of `engine/` on purpose: the engine renders and knows nothing about
 * the network, which is what lets it be driven from a test, a replay, or a
 * multiplayer message just as easily as from a fetch.
 */

export interface ChoreographRequest {
  prompt: string;
  characterName?: string;
  weaponName?: string;
  enemyName?: string;
}

export interface ChoreographResponse {
  /** Raw JSON from the model — pass through parseChoreography before playing. */
  choreography: unknown;
  source: 'primary' | 'fallback' | 'default';
  ms: number;
}

/**
 * Requests a choreography.
 *
 * Never throws. A network failure returns the same shape as a model failure
 * (`choreography: null`), which the parser turns into the default bonk — the
 * fight continues even with the backend down.
 */
export async function requestChoreography(
  request: ChoreographRequest,
  signal?: AbortSignal,
): Promise<ChoreographResponse> {
  try {
    const response = await fetch('/api/choreograph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      return { choreography: null, source: 'default', ms: 0 };
    }

    return (await response.json()) as ChoreographResponse;
  } catch {
    return { choreography: null, source: 'default', ms: 0 };
  }
}

// ------------------------------------------------------------------- judging

export interface JudgeResponse {
  score: number;
  reason: string;
  source: 'ai' | 'fallback';
}

/**
 * Asks the AI judge to score one attack.
 *
 * Never throws. A judging failure returns a modest score rather than nothing,
 * because a fight that stalls waiting for a verdict is worse than one scored
 * a little generously.
 */
export async function requestJudgement(request: {
  prompt: string;
  characterName: string;
  weaponName: string;
  enemyName: string;
}): Promise<JudgeResponse> {
  try {
    const response = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (response.ok) return (await response.json()) as JudgeResponse;
  } catch {
    // Fall through.
  }
  return { score: request.prompt.trim() ? 14 : 8, reason: '', source: 'fallback' };
}
