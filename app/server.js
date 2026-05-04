// Save-and-Publish Draft Editor
//
// This app has a known race condition between /draft and /publish.
// See README.md for the bug description and what you're being asked to do.

const express = require('express');
const path = require('path');

const DEBUG_RACE = process.env.DEBUG_RACE === '1';

function ts() {
  return new Date().toISOString();
}

function log(msg, obj) {
  if (!DEBUG_RACE) return;
  if (obj) {
    console.log(`[${ts()}] ${msg} ${JSON.stringify(obj)}`);
  } else {
    console.log(`[${ts()}] ${msg}`);
  }
}


const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

app.use((req, _res, next) => {
  // Allow harness/tests to provide an ID for traceability
  req._reqId = req.header('x-req-id') || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  next();
});



// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------
// `currentDraft` is the most recent saved draft.
// `publishedDraft` is what /publish has marked as live.
//
// In a real app these would live in a database. For this assignment, in-memory
// is fine — the bug is in the timing, not the storage.
let currentDraft = '';
let publishedDraft = '';
let latestSaveCommit = Promise.resolve();
// SAVE_COMMIT_DELAY_MS controls how long a /draft request takes to commit.
// In production this would represent database write latency, network latency,
// or any other delay between "request received" and "value updated."
//
// Set to 200ms by default to make the race condition reliably reproducible.
// Tests may override this via environment variable.
const SAVE_COMMIT_DELAY_MS = parseInt(process.env.SAVE_COMMIT_DELAY_MS || '200', 10);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /draft — save the current draft text.
//
// Note the artificial delay: the draft is not committed to currentDraft
// until SAVE_COMMIT_DELAY_MS milliseconds after the request arrives.

app.post('/draft', (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' });
  }

  const reqId = req._reqId;

  log('START /draft', {
    reqId,
    content,
    delayMs: SAVE_COMMIT_DELAY_MS,
    currentDraft_before: currentDraft,
    publishedDraft_before: publishedDraft,
  });

  // Simulate write latency.
  latestSaveCommit = new Promise((resolve) => {
    setTimeout(() => {
      log('COMMIT /draft (before write)', {
        reqId,
        writing: content,
        currentDraft_before: currentDraft,
        publishedDraft_before: publishedDraft,
      });

      currentDraft = content;

      log('END /draft (after write)', {
        reqId,
        currentDraft_after: currentDraft,
        publishedDraft_after: publishedDraft,
      });

      res.json({ ok: true, saved: content });
      resolve();
    }, SAVE_COMMIT_DELAY_MS);
  });

});


// POST /publish — mark the most recent saved draft as live.
//
// THE BUG: this reads currentDraft *immediately*. If a /draft request is
// in flight (its timeout hasn't fired), publishedDraft will be set to the
// older saved value, not the in-flight one.

app.post('/publish', async (req, res) => {
  const reqId = req._reqId;

  log('START /publish', {
    reqId,
    currentDraft_before: currentDraft,
    publishedDraft_before: publishedDraft,
  });

  // Wait for the most recent save to commit (if one is in flight).
  log('WAIT /publish (await latestSaveCommit)', { reqId });
  await latestSaveCommit;

  publishedDraft = currentDraft;

  log('END /publish', {
    reqId,
    currentDraft_after: currentDraft,
    publishedDraft_after: publishedDraft,
  });

  res.json({ ok: true, published: publishedDraft });
});


// GET /published — return the currently published draft.
app.get('/published', (req, res) => {
  res.json({ published: publishedDraft });
});

// GET /current — return the currently saved (committed) draft.
app.get('/current', (req, res) => {
  res.json({ current: currentDraft });
});

// Reset endpoint for tests.

app.post('/reset', (req, res) => {
  const reqId = req._reqId;
  currentDraft = '';
  publishedDraft = '';
  log('POST /reset', { reqId });
  res.json({ ok: true });
});


// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Draft editor running on http://localhost:${PORT}`);
    console.log(`SAVE_COMMIT_DELAY_MS = ${SAVE_COMMIT_DELAY_MS}`);
  });
}

module.exports = app;
