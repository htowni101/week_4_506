/**
 * Harness: deterministically reproduces the /draft + /publish race.
 *
 * Produces a clear log showing:
 * - save B started but had not committed yet
 * - publish ran while save B was in flight
 * - published value reflects stale state (on broken code)
 *
 * Run:
 *   node harness/race.js
 *
 * Capture trace:
 *   node harness/race.js | tee trace.txt
 */

const supertest = require('supertest');

// Enable server-side debug logs BEFORE importing the app.
process.env.DEBUG_RACE = '1';

// Force a deterministic delay so save is still "in flight".
process.env.SAVE_COMMIT_DELAY_MS = '300';

const app = require('../app/server.js');
const agent = supertest(app);

function ts() {
  return new Date().toISOString();
}

function hlog(msg, obj) {
  if (obj) console.log(`[${ts()}] HARNESS ${msg} ${JSON.stringify(obj)}`);
  else console.log(`[${ts()}] HARNESS ${msg}`);
}

async function main() {
  hlog('BEGIN');

  // 1) Reset state
  hlog('POST /reset (start)', { reqId: 'reset-1' });
  await agent.post('/reset').set('x-req-id', 'reset-1').expect(200);
  hlog('POST /reset (done)', { reqId: 'reset-1' });

  // 2) Save A and await it fully (this becomes the committed baseline)
  hlog('POST /draft A (start)', { reqId: 'draft-A', content: 'draft A' });
  await agent
    .post('/draft')
    .set('x-req-id', 'draft-A')
    .send({ content: 'draft A' })
    .expect(200);
  hlog('POST /draft A (done)', { reqId: 'draft-A' });

  // 3) Fire save B but do NOT await (in-flight save)
  hlog('POST /draft B (start, IN-FLIGHT)', { reqId: 'draft-B', content: 'draft B' });
  const savePromise = agent
    .post('/draft')
    .set('x-req-id', 'draft-B')
    .send({ content: 'draft B' });

  // 4) Immediately publish (should publish B, but broken code publishes A)
  hlog('POST /publish (start)', { reqId: 'publish-1' });
  const publishPromise = agent
    .post('/publish')
    .set('x-req-id', 'publish-1');

  // 5) Wait for both to finish in whatever order they finish
  const [saveResp, publishResp] = await Promise.all([savePromise, publishPromise]);

  hlog('POST /draft B (done)', { reqId: 'draft-B', status: saveResp.status, body: saveResp.body });
  hlog('POST /publish (done)', { reqId: 'publish-1', status: publishResp.status, body: publishResp.body });

  // 6) Query final states for clarity
  const current = await agent.get('/current').set('x-req-id', 'get-current-1').expect(200);
  const published = await agent.get('/published').set('x-req-id', 'get-published-1').expect(200);

  hlog('GET /current', current.body);
  hlog('GET /published', published.body);

  hlog('END', {
    expectedPublished: 'draft B',
    actualPublished: publishResp.body && publishResp.body.published,
  });
}

main().catch((err) => {
  console.error(`[${ts()}] HARNESS ERROR`, err);
  process.exit(1);
});
