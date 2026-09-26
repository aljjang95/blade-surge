# Blade Surge actual-play QA — 2026-09-27

Base: `main` at `73cd2fc0f647828336a7cba87a75681d08c85dbe`. This was a local Vite build of the complete repository, not the live deployment. The live `/version.json` reported `30b8fef5f2b947e2669a3ccac81f0d3bf88eead9` during this run.

## Played flows

Two independent fresh-origin sessions used the browser UI. The primary session reached the lobby, entered story 1-1, used attack/dodge/skill controls, enabled AUTO, cleared the first room, paused/resumed, gave up, saw the result, and returned to the lobby. The independent session used manual movement and skills, toggled AUTO, paused/resumed, fought the boss, reached VICTORY (52 kills, 154 seconds, 17 items), and returned to the lobby with the next adventure at 1-2. Independent observations did not reuse the primary tab. A separate isolated Chromium automation run supported movement and pause checks; its screenshots and console capture are automation evidence, not screenshots from the UI sessions.

## TUT-01 — misleading dodge lesson (P2 education)

Before: tutorial step 02/04 said “붉은 예고를 피하라” and asked for a dodge just before an enemy attack. The opening room showed no enemy attack telegraph. Action: press the dodge control once. After: the lesson advanced to 03/04, without requiring a telegraph or a perfect dodge. This happened in both independent browser sessions; the primary session's perfect-dodge count was still zero. `src/ui/tutorial.js` confirms that the advance condition is only the player's `dodge` state.

The lesson now says to use dodge for quick movement, gives the actual `K`/left-Shift bindings, and presents perfect dodge as an additional timing tip. On a new save, the revised 02/04 text rendered without clipping at a 1280×720 landscape viewport and a normal dodge still advanced to 03/04. This resolves the lesson/condition mismatch; it does not add a separate perfect-dodge practice encounter.

## Verification and limits

- Before the copy change, `bun run check`: typecheck, 959 passing tests, one pre-existing skip, zero failures, and production build passed.
- After the first copy change, the same full check passed. An independent reviewer found that only left Shift is bound; the wording was corrected, and the final production build passed. The final wording rendered in the game. No new test was added for a one-line copy edit.
- Separate independent run: 57 focused tests passed and isolated Chromium automation recorded zero console/page errors. These are separate from the manual browser observations.
- Full PRD performance/balance bands, real-device touch, audio listening, network/WebGL loss, death/revive, and save persistence after reload remain unverified.
- Other single observations are not confirmed defects: a skill input immediately after dodge did not fire, and the lobby camera briefly showed geometry during a return transition. Reproduce each under controlled input/timing before opening a fix.

No production deployment, payment, or account setting was changed.
