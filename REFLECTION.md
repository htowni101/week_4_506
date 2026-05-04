## 1) Why do we create a harness? Why is it worth the time, instead of just asking AI to fix the bug directly?
The harness makes the race condition reproducible on demand instead of relying on timing luck in the browser. In my case, `harness/race.js` consistently triggered the “save B in flight + publish” interleaving and produced a clear trace that showed the wrong publish result. That evidence made the fix objective: I could verify the bug first, then confirm the same harness stops reproducing it after the change.

## 2) Why is isolation important? Why does the harness drive the failing code path under controlled conditions instead of running the full app and hoping the bug fires?
Race conditions are timing-dependent and can disappear or appear depending on machine load and network timing, so “click testing” is unreliable. Isolation lets me control the environment—specifically by forcing `SAVE_COMMIT_DELAY_MS=300`—so the race happens deterministically. That saved time and ensured my logs/trace were actually proving the specific failure mode the assignment described.

## 3) How does modular design help in debugging? This bug had a clear seam between "save" and "publish." How would debugging have been different if the same logic were buried in a 500-line monolithic handler with no clear boundaries?
Because `/draft` and `/publish` are separate routes, I could instrument entry/exit logs and state values at the exact boundaries where stale state was read. The trace clearly showed `/publish` completing before the delayed `/draft` commit updated `currentDraft`. If that logic were buried in one monolithic handler, I would need many more logs to find the exact interleaving, and it would be harder to prove what state was read/written at each step.

## 4) What kinds of problems with a fix can a code review catch that an automated test cannot? Be specific — name a category of issue.
A code review can catch hidden assumptions and future failure modes that a narrow regression test won’t cover, such as reset/cancellation behavior, operational risks (requests hanging), and maintainability concerns. Tests can pass while the fix still has edge cases that would surface under different usage patterns or future changes. Review also checks whether the fix matches intended semantics, not just what one test happens to assert.

## 5) Quote from your review. Paste 1–3 lines from your actual review session — the most useful or interesting point your reviewer raised — and explain why testing alone wouldn't have surfaced it.
"Major failure mode: /reset does not interact with in-flight commits ... The delayed timer from /draft fires afterward and writes old content back into currentDraft, effectively undoing reset."

This wouldn’t necessarily be caught by the provided regression test because the test focuses on the `/draft` + `/publish` race and uses `/reset` only as a setup step. A reviewer is thinking about broader system behavior and isolation guarantees (e.g., stale timers writing after state is cleared), which a single scenario test may not cover even if CI is green.

