# Tutorials, screenshots, and narration (SPEC §11.4)

Statly ships four guided, in-app tutorials, one per practice dataset in
`fixtures/practice/`. Each tutorial has:

- A **narration script** (Markdown) in `content/tutorials/`, written for a
  reader (or a voice-over) walking through the app step by step: what to
  click, what you see, why the test was chosen, and the expected result.
- An **index entry** in `content/tutorials/tutorials.yaml`, the machine-
  readable version of the same steps (id, title, dataset, per-step screen,
  action, "why this matters" text, and screenshot filename), which the app
  can later load to drive an in-app guided tour.
- A set of **screenshots** under `docs/screenshots/<tutorial-id>/`,
  auto-captured from the running app so they can be regenerated whenever
  the UI changes, instead of going stale.

## The four tutorials

| id | Question | Dataset |
|---|---|---|
| `did-my-students-improve` | Did my students improve? | `one_group_prepost_likert` |
| `which-intervention-worked-best` | Which intervention worked best? | `three_groups_prepost_followup` |
| `cleaning-a-messy-qualtrics-export` | Cleaning a messy Qualtrics export | `messy_qualtrics` |
| `matching-students-across-time` | Matching students across time | `linked_id_prepost` |

## Regenerating screenshots

Screenshots are captured with Playwright, driving the same React UI that
ships in the desktop app, running in a real browser against the Vite dev
server in **mock-engine mode** (`VITE_STATLY_MOCK=1`, no Tauri, no Python
sidecar). This is a **separate Playwright project** from the normal e2e
suite (`app/playwright.config.ts` / `npm run test:e2e`), configured in
`app/playwright.screenshots.config.ts` and `app/e2e/screenshots/`, so
running it never affects or is affected by the regular e2e tests.

```bash
cd app
npm run screenshots          # light theme (default), 1280x800
npm run screenshots -- --dark   # dark theme
```

This walks each tutorial's steps (see `app/e2e/screenshots/capture.spec.ts`)
and saves one PNG per step to `docs/screenshots/<tutorial-id>/<step>.png`,
each with a small dark banner overlay in the top-left naming the tutorial
and step, plus a `docs/screenshots/capture-report.json` summary of which
steps captured, which were skipped, and which failed.

**Why not drive the built desktop app directly?** The SPEC's original
suggestion was to auto-capture screenshots "driving the built app." On
macOS, Tauri's app is a WebKit WebView, and WebKit's WebDriver
(`safaridriver`/WebKit WebDriver) doesn't support automating an arbitrary
embedded WebView the way it supports Safari itself, so there is no
supported way to point Playwright (or any other browser-automation tool)
at the packaged `Statly.app` on macOS. Since the desktop app and the
`npm run dev:mock` browser build render the exact same React UI, driving
the browser build is equivalent for screenshot purposes and much simpler
to run in CI.

### Steps that don't exist yet

Some tutorial steps reference screens that aren't built yet (for example,
a full mixed/repeated-measures ANOVA path in the Test Advisor, and the
Qualitative module's open-ended-response tagging screen). Those steps are
marked `built: false` in `tutorials.yaml` with a `todo` note, and the
capture script skips them cleanly (recorded as `"skipped"`, not
`"failed"`) instead of aborting the whole run. Re-run `npm run
screenshots` after those screens land to pick them up; you only need to
flip `built: true` and add a matching step in `capture.spec.ts`.

A step can also come back `"failed"` (rather than `"skipped"`) if a
selector it depends on changed or a screen threw an error at capture time;
check `docs/screenshots/capture-report.json` and the step's note after a
run, and Playwright's own trace/output under `app/test-results/` for
details.

## Recording narration (video)

The Markdown scripts in `content/tutorials/*.md` are written to be read
aloud, screen by screen, while recording:

1. Regenerate screenshots first (above) so you're following the current
   UI, not a stale one.
2. Open the app in the browser at `npm run dev:mock` (same URL the
   screenshot script uses: `http://localhost:1431` when run via `npm run
   screenshots`, or start your own `npm run dev:mock` session on whatever
   port you like for a live recording).
3. Follow the narration script's numbered steps in order. Each step gives
   you the action to perform, what the viewer should see on screen, the
   "why this matters" line to say out loud, and the expected result to
   call out once it appears.
4. Keep pacing to the grade 8-10 reading level and plain-language tone
   used throughout `content/learn/`: short sentences, no unexplained
   jargon, no em-dashes if you're reading verbatim.

## Adding a fifth tutorial later

1. Add an entry to `content/tutorials/tutorials.yaml` (id, title, dataset,
   narration path, steps).
2. Write the matching `content/tutorials/<id>.md` narration script: goal,
   dataset, 8-15 numbered steps, each with an action, what you see, a
   "why this test"/"why this matters" line, and the expected result.
3. Add a `test("<id>", ...)` block to
   `app/e2e/screenshots/capture.spec.ts` that mirrors the yaml step table
   (screen, action, screenshot filename, `built` flag).
4. Run `npm run screenshots` and check `docs/screenshots/capture-report.json`.
