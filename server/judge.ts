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

Where it lands matters. A player who names a target has aimed, and aim is
worth rewarding — but the reward is in how much damage a hit there would
plainly do, not in the naming:
- Somewhere fatal or disabling — the heart, the head, the throat, the eyes,
  the spine — belongs at the top of whatever band the writing earned, and can
  carry a move up into the next one.
- Somewhere survivable — a knee, a foot, an arm, a shoulder, the backside —
  stays at the bottom of its band. It can still be a superb move; it is simply
  not a killing one.
- A move that names no target is judged on the writing alone. Do not invent a
  target for them, and do not mark them down for it.

Lingering harm counts for more than a single blow. Poison, venom, sickness,
infection, rot, burning, bleeding, curses — anything that goes on hurting
after the move ends — plainly does more damage than the same idea delivered
once, so score it a band higher than the writing alone would earn. It has to
be genuinely in what they wrote; do not read poison into an ordinary stab.

Worked examples, which are the scale. Score against these, not against your
own sense of what a number ought to mean:

  "poop on opponent"                                          5
  "fart on opponent"                                          6
  "fire arrow at opponent"                                   10
  "shoot rapid fire to the chest"                            20
  "swing axe on opponent's neck"                             20
  "uppercut, punch to the gut, shoot their leg, then bite"   27

Read what those are worth. A joke with no force behind it sits near the
bottom. A plain ranged attack with no target named is about ten. A serious
attack on somewhere that matters — rapid fire to the chest, an axe to the neck
— is about twenty, and twenty is not a ceiling.

A combination is worth more than any of its parts. Several distinct attacks
strung together, each one landing somewhere, is the top of the scale: that is
what 27 and upward is for, and what 33 looks like. Do not treat a long
combination as padding — count the blows.

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
