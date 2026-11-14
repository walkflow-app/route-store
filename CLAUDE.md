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

- **New routes**: skill `make-route` (the order of work and the pitfalls).
- **Before a route pull request is merged**: agent `route-reviewer` (facts against sources, texts, privacy, the map).

## Commands

```bash
node scripts/build-store.mjs --check --files-only   # the store check (needs ../walkflow with npm ci)
node --test                                         # the tests of the scripts
```

## Never without being asked

Force-push, merge with `--admin`, change repository settings, rulesets or secrets, or delete branches other than your own.
Push to `main`: changes go there only through pull requests with `check` and `tests` green. The ruleset cannot enforce
this yet (CI pushes the index commit directly), so it is on you.
