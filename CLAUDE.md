# Walkflow route store: notes for agents

Routes that the Walkflow app offers in its store, and the tooling to make and check them. Read [README.md](README.md) first:
*Adding a route*, *How the checks work*, *Reviewing a route* and *Making a route from OpenStreetMap* are the instructions;
this file only adds what an agent tends to miss.

[ROADMAP.md](ROADMAP.md) is the public plan of this repository; only the maintainer moves something into *Now*, and a pull
request that finishes or drops a roadmap item updates it. Internal planning (specs across repositories, decisions) is in the
private repository `walkflow-app/meta`, cloned next to this one as `../meta`; never copy internal notes from there into this
public repository without the maintainer agreeing.

## Rules

- **One route per pull request**, from its own branch (`feat/route-<file name>`), title `feat: <name> in <place>`. CI fails a
  pull request that changes more than one file in `routes/`.
- **Never touch `index.json`.** CI writes it after the merge.
- **Making a route:** a spec in `specs/`, then `node scripts/make-route.mjs specs/<file>.json --dry` first, then with
  `--preview <file>.svg`, and look at the picture before opening a pull request. The script needs the app checked out at
  `../walkflow` with `npm ci` (or `--app` / `$WALKFLOW_APP`). Overpass often answers 502; the script retries, run it again.
- **Facts only from sources you actually read** (e.g. Wikipedia), their URLs go into the spec's `sources`; where sources
  disagree, say less. Texts in en, de, fr and uk; say in the pull request that fr and uk are not proofread by a native speaker.
- What worked and what did not: lake loops with a shore path work; parks tend to wander off. City walks A→B snap their stops to
  graph nodes (a long bridge needs a node as a stop), `--streets` shows which streets the route takes, `spur` cuts short
  out-and-back side trips, a waypoint must be within 150 m of the route.
- Never put a route in the store that gives away where someone lives.
- A change to `scripts/build-store.mjs`, the workflows, or the app's route code is a change to the checks of the store: say so
  in the pull request.
- **English** in the repository, except the translated route texts.

## How work is done here

**The whole picture** (the same text is in the `CLAUDE.md` of every repository of walkflow-app; if a rule does not fit it, say so):

- **Goal:** everyone with a treadmill at home can walk every day: free, fun, simple. We collect no data about individual users;
  anonymous statistics to improve the app are fine. Safety is a matter of course, never a reason to stall other work.
- **Flow:** an issue; for bigger work a reviewed spec in a Feature issue, where the maintainer's comment `approved` is the go for
  all of it; then tasks (sub-issues with blockers), one Builder and one pull request per task, agent review, fix, the pipeline
  merges, one release.
- **Roles:** the maintainer decides direction and does what only a person can. The **PM** (the planning agent the maintainer works
  with) owns every open item, starts tasks, looks at `stuck` first and prepares releases. A Builder builds one task and decides
  a small gap itself. Reviewers answer `OK`, `OK with remarks`, `changes needed` or `blocking` (a real defect only).
- **Belt code** (`SAFETY` in `scripts/paths.mjs`): test first, never weaken a limit, a delay or a stop, reviewed by two models, one
  of them as the safety reviewer, label `needs-hardware`. Everything else is ordinary work, also when it lies nearby.
- **The treadmill:** one guided session by the maintainer per release, only if belt code or a `needs-hardware` item is in it,
  then one `/hardware-ok` on the release pull request after the last merge. Never per task or per merge.
- **Stop list** (only these wait for the maintainer): approving a feature; scope, non-goals, what a person sees; a new runtime
  dependency; data that leaves the device or a new third party; money or an account; the treadmill and `/hardware-ok`; facts only
  the maintainer has; secrets, settings, rulesets; publishing; the rules themselves (`CLAUDE.md`, `.claude/`, workflows, gates).
- **Handing back:** for a stop-list item the label `needs-maintainer` and a line `Stop: <item>`; anything else is yours to decide,
  or `stuck` (the pipeline's label; the PM looks). A material spec gap: a `Spec gap:` comment with a proposal and `Stop:`.
- **A rule that does not fit:** follow the principles as far as you can, and write the rule with a proposed change under
  **Process notes** in your pull request or last comment. Never loosen a rule in your own run.

**In this repository** there is no belt code: a route is one file in `routes/` with its spec, one route per pull request, checked
by the route reviewer. The agent pipeline of walkflow runs here too (`scripts/agent-pipeline.mjs`, the same file with this
repository's lists in `scripts/paths.mjs`, both empty, and the required checks `check`, `tests` and `released-app`): once the maintainer sets the
repository variable `AGENT_PIPELINE` to `on`, a route that the route reviewer passes and CI accepts is merged by the pipeline.
Protected, for the maintainer: `.github/`, `.claude/`, `CLAUDE.md`, `README.md` (the instructions), `scripts/`, `tests/` and `index.json`. A fix after a review is always reviewed again.

- **New routes**: skill `make-route` (the order of work and the pitfalls).
- **Before a route pull request is merged**: agent `route-reviewer` (facts against sources, texts, privacy, the map).
  Reviewers run with another model than the one that wrote the change: written with Opus, the reviewer runs with Sonnet, and
  the other way round; when that is unclear, Opus for the store checks or big changes, else Sonnet. On GitHub
  `.github/scripts/review-model.sh` picks it the same way, from the Co-Authored-By lines of the commits.
- **On GitHub:** `agent-review.yml` runs the reviewers on every new pull request and posts their verdicts (comment
  `@claude review` to run it again); `claude.yml` takes on `@claude …` requests and issues labelled `agent-ready`, issues
  of every kind (nothing here is belt code). Both only work on branches and pull requests; with `AGENT_PIPELINE` on,
  `agent-pipeline.yml` (every 15 minutes and after each review, check or fix) merges what is reviewed, green and up to date,
  `agent-fix.yml` fixes remarks, failing checks and conflicts, and `dispatch.yml` starts the tasks of an approved Feature. Only the
  rules themselves (`needs-maintainer`) wait for the maintainer; everything else stuck gets `stuck` for the PM. Until then the PM
  or the maintainer merges. New issues from outside:
  `triage.yml` (labels and one comment, never `agent-ready`).

## Commands

```bash
node scripts/build-store.mjs --check --files-only   # the store check (needs ../walkflow with npm ci)
node --test                                         # the tests of the scripts
```

## Never without being asked

Force-push, merge with `--admin`, change repository settings, rulesets or secrets, or delete branches other than your own.
`main` takes changes only through pull requests with `check` and `tests` green; the ruleset lets only CI's index commit
(pushed with a deploy key) past.
