import Anthropic from '@anthropic-ai/sdk';
import { extractJson } from './choreographer';

/**
 * The AI judge, for two-player games.
 *
 * The brief puts Sonnet here rather than Haiku: scoring is a judgement call
 * about whether a described move is inventive and whether it would plausibly
 * hurt, which is exactly the sort of thing a bigger model is worth paying for.
 * Choreography is structure and Haiku handles it; this is taste.
 */

const client = new Anthropic();
const MODEL = process.env.JUDGE_MODEL ?? 'claude-sonnet-5';
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

How to score:
- ${MAX_SCORE} is a devastating, perfectly-judged hit. 0 is a total whiff.
- Most decent attacks land between 12 and 24. Keep the middle busy.
- Reward invention, specificity, and using the weapon as described.
- Reward funny. This is a party game; a brilliant joke beats a dull optimum.
- A vague or empty description is a plain swing: score it 6 to 12.
- Do not reward length. Fifty dull words beat nothing, but not much.
- Do not punish a player for a weapon that makes no sense. That is the game.

Be decisive and vary your scores. A judge who gives everything 18 is no judge.`;

export async function judge(request: JudgeRequest): Promise<JudgeResult> {
  const described = request.prompt.trim();

  try {
    const message = await client.messages.create({
      model: MODEL,
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
