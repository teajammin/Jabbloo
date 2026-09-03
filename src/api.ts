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
