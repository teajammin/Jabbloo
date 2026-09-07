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

// Background removal degrades instead of failing.
{
  const noKey = await handleApi('/api/cutout', { image: 'data:image/png;base64,AAAA' }, {});
  check('with nothing configured it reports unavailable', body(noKey)['available'] === false);
  check('with a reason the client can log', typeof body(noKey)['reason'] === 'string');

  const rubbish = await handleApi('/api/cutout', { image: 'not an image' }, {
    REMOVEBG_API_KEY: 'test',
  });
  check('a non-image is rejected', rubbish?.status === 400, String(rubbish?.status));
  check('and never reported as available', body(rubbish)['available'] === false);

  // A local service that is configured but not running must not take the
  // request down with it: whatever else is set up still gets a turn, and
  // failing that the browser cuts the photo out itself.
  const deadLocal = await handleApi('/api/cutout', {
    image: 'data:image/png;base64,AAAA',
  }, { REMBG_URL: 'http://127.0.0.1:9' });
  check('an unreachable local service falls through', deadLocal?.status === 200,
    String(deadLocal?.status));
  check('and says so rather than erroring', body(deadLocal)['available'] === false,
    JSON.stringify(body(deadLocal)));
}

// Health says which cutout is available, since the drawing tool words its
// message differently for a service and for the browser's own.
{
  const none = await handleApi('/api/health', {}, {});
  check('no cutout is reported as none', body(none)['cutout'] === false);

  const local = await handleApi('/api/health', {}, { REMBG_URL: 'http://127.0.0.1:7000' });
  check('a local service is reported as local', body(local)['cutout'] === 'local');

  const hosted = await handleApi('/api/health', {}, { REMOVEBG_API_KEY: 'k' });
  check('a key is reported as the hosted service', body(hosted)['cutout'] === 'removebg');

  const both = await handleApi('/api/health', {}, {
    REMBG_URL: 'http://127.0.0.1:7000', REMOVEBG_API_KEY: 'k',
  });
  check('local wins when both are there', body(both)['cutout'] === 'local');
}

// Anything else belongs to whoever called: static files, in the worker's case.
{
  check('an unknown path is not claimed', await handleApi('/api/nope', {}, {}) === null);
  check('nor is the site itself', await handleApi('/', {}, {}) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
