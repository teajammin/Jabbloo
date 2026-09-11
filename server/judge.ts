import Anthropic from '@anthropic-ai/sdk';
import { extractJson } from './choreographer';
import { clientFor, type AiConfig } from './ai';

/**
 * The AI judge, for two-player games.
 *
 * The brief puts Sonnet here rather than Haiku: scoring is a judgement call
 * about whether a described move is inventive and whether it would plausibly
 * hurt, which is exactly the sort of thing a bigger model is worth paying for.
 * Choreography is structure and Haiku handles it; this is taste.
 */

const MAX_SCORE = 33;

export interface JudgeRequest {
  characterName: string;
  weaponName: string;
  enemyName: string;
  prompt: string;
}

export interface JudgeResult {
  score: number;
  reason: string;
  source: 'ai' | 'fallback';
}

const SYSTEM = `You are the judge in Jabbloo, a silly party fighting game where players draw their own characters and weapons and describe how they attack.

Score one attack out of ${MAX_SCORE} for how much damage it should do.

Respond with ONLY JSON: {"score": <0-${MAX_SCORE}>, "reason": "<up to 12 words>"}

USE THE WHOLE SCALE. The commonest failure in this job is scoring everything
between 12 and 18, which tells the players nothing and makes the fight a draw.
A great move and a lazy one must be far apart on the scoreboard.

The bands, and roughly how often each should come up:

  0-4    nothing happened. Empty, incoherent, or the player gave up.
  5-10   a plain swing. No idea beyond hitting them with the thing.
  11-16  a decent idea, thinly described, or a good idea badly aimed.
  17-23  a real move: specific, uses the weapon, you can picture it.
  24-29  inventive or very funny, and it would plainly hurt.
  30-33  the best thing you have read all night. Rare, and unmistakable.

How to judge:
- Reward invention, specificity, and using the weapon as described.
- Reward funny. This is a party game; a brilliant joke beats a dull optimum.
- Two attacks that differ in quality must differ by at least 8 points.
- Do not reward length. Fifty dull words beat nothing, but not much.
- Do not punish a player for a weapon that makes no sense. That is the game.
- Never reach for the middle because you are unsure. Pick a band and commit.

Ask yourself: would the room cheer, laugh, or shrug? Score the answer.`;

export async function judge(request: JudgeRequest, config: AiConfig): Promise<JudgeResult> {
  const described = request.prompt.trim();

  try {
    const message = await clientFor(config).messages.create({
      model: config.judge,
      max_tokens: 200,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          `${request.characterName} attacks ${request.enemyName} with the ${request.weaponName}.`,
          '',
          described ? `They say: "${described}"` : 'They said nothing at all.',
          '',
          'Score it. JSON only.',
        ].join('\n'),
      }],
    });

    if (message.stop_reason === 'refusal') throw new Error('refused');

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const parsed = extractJson(text) as { score?: unknown; reason?: unknown } | null;
    const raw = typeof parsed?.score === 'number' ? parsed.score : NaN;
    if (!Number.isFinite(raw)) throw new Error('no score');

    return {
      score: Math.max(0, Math.min(MAX_SCORE, Math.round(raw))),
      reason: typeof parsed?.reason === 'string' ? parsed.reason.slice(0, 80) : '',
      source: 'ai',
    };
  } catch (error) {
    console.warn('[judge]', error instanceof Error ? error.message : error);
    // A fight must never stall on a judging failure, so an unscored move gets
    // a modest hit rather than nothing: the round still means something.
    return {
      score: described ? 14 : 8,
      reason: 'the judge was distracted',
      source: 'fallback',
    };
  }
}
