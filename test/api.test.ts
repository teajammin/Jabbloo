/**
 * API routing tests.
 *
 * The same `handleApi` serves the dev server and the deployed worker, so the
 * shape it returns is the contract between the browser and both of them. What
 * is checked here is the behaviour that has to hold with no key, no network
 * and no server — the cases a player hits when something is misconfigured,
 * which must degrade rather than break.
 */
import { handleApi } from '../server/api';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const body = (result: { body: unknown } | null) => result?.body as Record<string, unknown>;

// Health reports what is configured, and never what it is.
{
  const bare = await handleApi('/api/health', {}, {});
  check('health answers', bare?.status === 200, String(bare?.status));
  check('an unkeyed server says so', body(bare)['keyConfigured'] === false);
  check('and names its models anyway', body(bare)['model'] === 'claude-haiku-4-5');

  const keyed = await handleApi('/api/health', {}, {
    ANTHROPIC_API_KEY: 'sk-test-not-a-real-key',
    CHOREOGRAPHER_MODEL: 'claude-opus-5',
  });
  check('a keyed server says so', body(keyed)['keyConfigured'] === true);
  check('the key itself is never echoed',
    !JSON.stringify(body(keyed)).includes('sk-test'), JSON.stringify(body(keyed)));
  check('a configured model overrides the default',
    body(keyed)['model'] === 'claude-opus-5', String(body(keyed)['model']));
}

// A prompt is required before any model is called.
{
  const empty = await handleApi('/api/choreograph', { prompt: '   ' }, {});
  check('an empty prompt is refused before a model is called', empty?.status === 400,
    String(empty?.status));
}

// The endpoints that cost money are guarded when a guard is supplied.
//
// In development nothing is passed and every call goes through, because the
// server is on the same laptop as the person using it. Deployed, the worker
// passes one that asks the room whether the caller is the screen running a
// fight — the difference between a party game and a model anybody with the
// URL can run at somebody else's expense.
{
  const fight = {
    prompt: 'swing it overhead', characterName: 'Ann',
    weaponName: 'Sword', enemyName: 'Bo',
  };

  const refuse = async () => false;
  const blocked = await handleApi('/api/choreograph', fight, {}, refuse);
  check('an unvouched choreography is refused', blocked?.status === 403, String(blocked?.status));
  check('and no model was called',
    JSON.stringify(blocked?.body).includes('not in a fight'), JSON.stringify(blocked?.body));

  const judged = await handleApi('/api/judge', fight, {}, refuse);
  check('an unvouched judgement is refused too', judged?.status === 403, String(judged?.status));

  // The room is asked about the right game and the right screen.
  let asked = null;
  const record = async (room: string, device: string) => { asked = { room, device }; return false; };
  await handleApi('/api/choreograph', { ...fight, room: 'ABCD', device: 'screen-1' }, {}, record);
  check('the room and the screen are both passed on',
    JSON.stringify(asked) === JSON.stringify({ room: 'ABCD', device: 'screen-1' }),
    JSON.stringify(asked));

  // A call with no room named cannot be vouched for at all.
  let called = false;
  const never = async () => { called = true; return true; };
  const anonymous = await handleApi('/api/choreograph', fight, {}, never);
  check('a call naming no game is refused without asking',
    anonymous?.status === 403 && !called, `${anonymous?.status} asked=${called}`);

  // Health stays open: it names no game and spends nothing.
  const health = await handleApi('/api/health', {}, {}, refuse);
  check('health is not guarded', health?.status === 200, String(health?.status));
}

// Anything else belongs to whoever called: static files, in the worker's case.
{
  check('an unknown path is not claimed', await handleApi('/api/nope', {}, {}) === null);
  check('nor is the site itself', await handleApi('/', {}, {}) === null);
  // Background removal was removed from the game; the endpoint went with it,
  // and nothing should answer on that path any more.
  check('the retired cutout endpoint is gone',
    await handleApi('/api/cutout', { image: 'x' }, {}) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
