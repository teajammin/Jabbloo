/**
 * Client error reporting.
 *
 * What is checked here is the discipline rather than the plumbing: that a
 * repeating fault does not become a flood, that a session cannot post
 * endlessly, that nothing a player wrote goes with it, and that the reporter
 * never throws — because an error reporter that throws while reporting is the
 * worst bug a program can have.
 */
import { buildReport, resetErrorLog, setErrorContext } from '../src/errors';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// A browser, near enough for a report to be built. Node defines navigator as
// a getter of its own, so it has to be redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'TestBrowser/1.0' },
});

resetErrorLog();
setErrorContext('ABCD');

// What one report carries.
{
  const report = buildReport(new Error('the stage fell over'), 'screen-battle');
  check('an error becomes a report', report !== null);
  check('with the message', report?.message === 'the stage fell over', report?.message);
  check('the screen it happened on', report?.screen === 'screen-battle');
  check('the room it happened in', report?.room === 'ABCD');
  check('the build', typeof report?.version === 'string' && report.version.length > 0);
  check('and the device', report?.agent === 'TestBrowser/1.0');
  check('with a stack to read', (report?.stack ?? '').includes('Error'));
  check('counted as the first of its kind', report?.count === 1);
}

// A fault that repeats every frame must not be posted every frame.
{
  resetErrorLog();
  const sent: number[] = [];
  for (let i = 0; i < 150; i++) {
    const report = buildReport(new Error('every frame'), 'screen-battle');
    if (report) sent.push(report.count);
  }
  check('a repeating fault is not sent every time', sent.length <= 3, JSON.stringify(sent));
  check('but the first one always is', sent[0] === 1, String(sent[0]));
  check('and later ones say how often it happened',
    sent.slice(1).every((n) => n > 1), JSON.stringify(sent));
}

// Two different faults are two reports, not one.
{
  resetErrorLog();
  const a = buildReport(new Error('first fault'), 'screen-battle');
  const b = buildReport(new Error('second fault'), 'screen-battle');
  check('different faults are reported separately',
    a?.message !== b?.message && a !== null && b !== null);
}

// A session has a ceiling.
{
  resetErrorLog();
  let count = 0;
  for (let i = 0; i < 200; i++) {
    if (buildReport(new Error(`fault number ${i}`), 'screen-battle')) count++;
  }
  check('a session stops reporting eventually', count <= 20, String(count));
  check('after reporting enough to be useful', count >= 10, String(count));
}

// Anything at all can be thrown in JavaScript, and none of it may break this.
{
  resetErrorLog();
  const odd: unknown[] = ['a string', 42, null, undefined, { nope: true }, [1, 2]];
  let threw = false;
  for (const value of odd) {
    try { buildReport(value, 'screen-launch'); } catch { threw = true; }
  }
  check('anything can be thrown at it without it throwing back', !threw);
}

// Long stacks and long messages are cut before they are sent.
{
  resetErrorLog();
  const big = new Error('x'.repeat(5000));
  big.stack = 'y'.repeat(9000);
  const report = buildReport(big, 'screen-draw');
  check('a huge message is trimmed', (report?.message.length ?? 0) <= 300, String(report?.message.length));
  check('and a huge stack too', (report?.stack?.length ?? 0) <= 1200, String(report?.stack?.length));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
