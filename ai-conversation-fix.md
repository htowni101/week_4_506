# AI Conversation — Fix Step

## My Prompt (with trace evidence)
I have a race condition between POST /draft and POST /publish.

In trace.txt, the timestamps show /publish completes before the delayed /draft B commit happens:
- /draft B START occurs, then /publish START+END happens while currentDraft is still "draft A"
- later, /draft B COMMIT sets currentDraft to "draft B"
- result: publishedDraft becomes "draft A" (stale) while currentDraft becomes "draft B"

The fix must guarantee that /publish always reflects the most recently committed save even if a save is in flight.
Please propose a minimal fix for this Node/Express app.

Here is the relevant code (app/server.js routes for /draft and /publish):
  55
    56  // ---------------------------------------------------------------------------
    57  // Routes
    58  // ---------------------------------------------------------------------------
    59
    60  // POST /draft — save the current draft text.
    61  //
    62  // Note the artificial delay: the draft is not committed to currentDraft
    63  // until SAVE_COMMIT_DELAY_MS milliseconds after the request arrives.
    64
    65  app.post('/draft', (req, res) => {
    66    const { content } = req.body;
    67    if (typeof content !== 'string') {
    68      return res.status(400).json({ error: 'content must be a string' });
    69    }
    70
    71    const reqId = req._reqId;
    72
    73    log('START /draft', {
    74      reqId,
    75      content,
    76      delayMs: SAVE_COMMIT_DELAY_MS,
    77      currentDraft_before: currentDraft,
    78      publishedDraft_before: publishedDraft,
    79    });
    80
    81    // Simulate write latency.
    82    latestSaveCommit = new Promise((resolve) => {
    83      setTimeout(() => {
    84        log('COMMIT /draft (before write)', {
    85          reqId,
    86          writing: content,
    87          currentDraft_before: currentDraft,
    88          publishedDraft_before: publishedDraft,
    89        });
    90
    91        currentDraft = content;
    92
    93        log('END /draft (after write)', {
    94          reqId,
    95          currentDraft_after: currentDraft,
    96          publishedDraft_after: publishedDraft,
    97        });
    98
    99        res.json({ ok: true, saved: content });
   100        resolve();
   101      }, SAVE_COMMIT_DELAY_MS);
   102    });
   103
   104  });
   105
   106
   107  // POST /publish — mark the most recent saved draft as live.
   108  //
   109  // THE BUG: this reads currentDraft *immediately*. If a /draft request is
   110  // in flight (its timeout hasn't fired), publishedDraft will be set to the
   111  // older saved value, not the in-flight one.
   112
   113  app.post('/publish', async (req, res) => {
   114    const reqId = req._reqId;
   115
   116    log('START /publish', {
   117      reqId,
   118      currentDraft_before: currentDraft,
   119      publishedDraft_before: publishedDraft,
   120    });
   121
   122    // Wait for the most recent save to commit (if one is in flight).
   123    log('WAIT /publish (await latestSaveCommit)', { reqId });
   124    await latestSaveCommit;
   125
   126    publishedDraft = currentDraft;
   127
   128    log('END /publish', {
   129      reqId,
   130      currentDraft_after: currentDraft,
   131      publishedDraft_after: publishedDraft,
   132    });
   133
   134    res.json({ ok: true, published: publishedDraft });
   135  });
   136
   137
   138  // GET /published — return the currently published draft.
   139  app.get('/published', (req, res) => {
   140    res.json({ published: publishedDraft });

## AI Response
The race condition occurs because /publish reads currentDraft immediately,
while a /draft request may still be in flight due to the delayed commit.

A clean fix is to track the completion of the most recent /draft operation
using a Promise, and ensure that /publish waits for that Promise before reading
currentDraft.

Implementation approach:
- Introduce a variable (e.g., latestSaveCommit) initialized to a resolved Promise.
- In the /draft handler, wrap the delayed commit in a new Promise and assign it
  to latestSaveCommit. Resolve the Promise after currentDraft is updated.
- In the /publish handler, convert it to an async function and await
  latestSaveCommit before reading currentDraft.

This ensures that if a save is in progress, /publish will wait for it to complete,
guaranteeing that it always publishes the most recent committed draft.


## What I Implemented
- I implemented a `latestSaveCommit` promise that represents the completion of the most recent save commit.
- /draft updates `latestSaveCommit` and resolves it after committing currentDraft.
- /publish awaits `latestSaveCommit` before reading currentDraft.

## Result
- `npm test` now passes both tests.
- Running the harness now shows publish returning "draft B" when save B is in flight (see trace-after-fix.txt).
