# Walkflow route store

Routes that people contributed to [Walkflow](https://github.com/walkflow-app/walkflow). The app lists them in **Routes → Route
store** and adds a route to the person's library only after they picked it and confirmed. How the app uses the store is
described in [`docs/ROUTE-STORE.md`](https://github.com/walkflow-app/walkflow/blob/main/docs/ROUTE-STORE.md) in the app's repository.

```
index.json          the list the app reads; written by CI after a merge, never by hand
routes/*.walkflow   one route package per file
specs/*.json        how the routes of the project were made (see "Making a route from OpenStreetMap")
scripts/            make-route.mjs (spec → route), build-store.mjs (the check and the index), the map for pull requests
tests/              tests of those scripts: node --test
```

## Adding a route

1. Get a route package: in the app **Routes → ⋯ → Export as package**
   ([format](https://github.com/walkflow-app/walkflow/blob/main/docs/ROUTE-PACKAGE.md)).
2. Open the file in a text editor and add who made it and under which terms:
   ```json
   "author": "Your name",
   "license": "CC0-1.0",
   "source": "Where the track comes from, e.g. © OpenStreetMap contributors (ODbL)",
   ```
   `license` is required: a route is only accepted if you say under which terms others may use it. If the track is
   derived from someone else's data, the `source` says whose. Do not add a route that gives away where you live.
   Also helpful: `name` and `place` in several languages, a `country`, and a few lower-case `tags`. Places worth a word along
   the way go into `waypoints`: the check fails if one is more than 150 m from the route.
3. Put the file in `routes/`. The name uses lower-case letters, digits, `.`, `_`, `-` and ends in `.walkflow`,
   e.g. `alster-rundweg.walkflow`. Do not change the line endings (the file is hashed as it is).
4. Open a pull request with the file: **one route per pull request**. **Do not touch `index.json`**: it is written by CI after the
   merge, from the files. CI checks the file and fails if the pull request changes more than one file in `routes/`, or if the file is
   not a valid package, has no `license`, has a waypoint far from the route, or is a copy of another file. CI also writes a
   **map of the route** as a comment into the pull request, and changes it on every push, so you and the reviewer can see where the
   route goes without opening the file (see [Reviewing a route](#reviewing-a-route)).

## Changing a route

Edit the file in `routes/` and **raise its `"revision"`** (add `"revision": 2` after `"version": 1` if there is none). People who
have the route get an offer to update it. Keep the file name: it is what identifies the route.

A route in the store is shown to everyone, so a maintainer looks at each pull request before it is merged.

## How the checks work

What counts as a valid route is decided by the app's own code, so a route that passes is one the app can read. The code is in
[walkflow-app/walkflow](https://github.com/walkflow-app/walkflow) (`src/core/store/route-index.ts`, `route-package.ts`,
`route-waypoints.ts`); `scripts/build-store.mjs` here bundles it with the app's esbuild and runs it on the files. The workflow checks the
app out (`main`) and runs `scripts/build-store.mjs --app <app checkout> --check --files-only` on a pull request. After a merge to
`main` it runs the same script without `--check`, which writes `index.json`, and commits the result if it changed. A second workflow,
`Route preview`, writes the map into the pull request; it never runs code of the pull request, only reads the route file as text.
A change to `scripts/build-store.mjs`, to the workflows, or to the app's route code is a change to the checks of the store.
Changes go to `main` through pull requests with both checks green; only the index commit of CI is pushed there directly (which is
why the ruleset cannot require pull requests yet). Rules for AI
agents are in `CLAUDE.md`, the commands they may run in `.claude/settings.json`, the `make-route` skill and the
`route-reviewer` agent in `.claude/`.

On your computer: clone the app next to this repository (`git clone https://github.com/walkflow-app/walkflow`), run `npm ci` in it, then
`node scripts/build-store.mjs --check --files-only` here (`--app` or `$WALKFLOW_APP` if the app is somewhere else) and `node --test` for the
tests (the ones that need the app are skipped without it; Node 22 or newer). There is no shared library: the little that `make-route.mjs` has in common with the app (the 150 m for a waypoint, the way a package is
written) is a few lines. The store check fails a file that breaks the app's rules, and `tests/app-package.test.mjs` compares what the script
writes with the app's own writer, so a drift shows in the CI of this repository. A library only pays off once more code has to be shared.

## Reviewing a route

**One route per pull request.** A review looks at one map and one set of texts, and a route that is not right can be sent back without
holding up the others. The check fails a pull request that adds, changes, deletes or renames more than one file in `routes/`. A failed
check only blocks the merge if the repository requires it (Settings → Branches → require the status check `check`); a maintainer can
always merge anyway.

**The map.** GitHub shows a `geojson` code block in Markdown as a map on OpenStreetMap, in a pull request as well. For every pull
request that changes a route, the workflow `Route preview` (`.github/workflows/preview.yml`) writes one comment with a map of the route
file: the route is the line, the start green, the goal red, the waypoints blue (a click shows their text).

- The comment is **changed on every push**, not added to, and names the commit it was made from. The map is made from the file in the
  pull request, so it cannot differ from what would be merged. If the route is changed in the pull request, nothing has to be done.
- The workflow runs on `pull_request_target`, because only that may write a comment on a pull request from a fork. That is safe as long
  as it never runs code of the pull request, and it does not: it checks out the base branch, reads the route file through the GitHub
  API as text and only parses it as JSON (`scripts/route-preview-pr.mjs`, which uses `scripts/route-preview.mjs`). The texts of the
  file are written into the map so that no text can end the code block, outside the map the comment has only numbers and the file
  name, and only a comment of `github-actions[bot]` that starts with the marker is ever changed. A change to these files or to
  `preview.yml` is a change to what a stranger's pull request can make the bot write, so it is reviewed with care. Do not add a `ref:`
  to the checkout of that workflow, or any step that runs the pull request.
- A route bigger than a comment takes (65,536 characters) is thinned out for the map, up to a few metres from its line; the comment says
  so. The texts of the route are read in the diff of the file.
- On your own computer: `node scripts/route-preview.mjs routes/x.walkflow > map.md` writes the same Markdown to paste into a comment.
  `node --test` runs the tests of the scripts (no dependencies; Node 22 or newer).

## Making a route from OpenStreetMap

The routes that the project adds itself (author `Walkflow`) are made by `scripts/make-route.mjs` from a **spec** in `specs/`, in one of
two ways. **A loop:** the outline of a lake or a park is taken from OpenStreetMap, laid onto the paths around it, and the pieces are
joined by shortest paths, so the loop follows the real paths. **A walk from one place to another** (through a city, say): the places worth
a word along the way come first, and the route is the shortest way over paths and streets from one to the next. A person who adds a route
exports it from the app instead (see "Adding a route"). The specs stay in the repository, so a route can be made again, or changed, from
what it was made from.

1. **Pick the place.** A lake with a path along its shore works well. A park only works if its outline follows a path: with
   three parks that were tried (Regent's Park, Vondelpark, Tempelhofer Feld) the loop wandered off through the park. A lake that is
   several pieces in OpenStreetMap (Sortedams Sø in Copenhagen) gives only its largest piece. Take the
   OpenStreetMap id from the address of its page (`openstreetmap.org/relation/62215` → `relation/62215`, a way is `way/<id>`).
   **A walk from one place to another** has no lake: find the places first (a square, a bridge, a building; 4 to 6 for 2 to 3 km),
   in the order they are walked, start and goal included, and take the coordinates of each from OpenStreetMap (the address of its
   page, or Nominatim). The route goes through them.
2. **Write a spec**, `specs/<file>.json` (the folder has examples of both kinds):

   | Field | Meaning |
   |---|---|
   | `file` | Name of the package without `.walkflow`: lower-case letters, digits, `.` `_` `-`. Place first, then the feature (`berlin-schlachtensee`). |
   | `osm` | `relation/<id>` or `way/<id>` of the lake or park. Leave it out for a walk from one place to another: the route then goes through the `waypoints` in order. |
   | `path` | Only without `osm`, optional: a list of `[lat, lon]` the route goes through instead of the waypoints, when it needs more places than there are waypoints to be kept to the street that is meant (a bridge, a crossing, the street up to a castle instead of a side lane). The first is the start and the last the goal. |
   | `step`, `snapDist`, `corr`, `pen` | How the loop is laid, all optional: the outline is sampled every `step` m (200); a sample is snapped to a path within `snapDist` m (60); only paths within `corr` m of the outline are used (60), and the further from it, the dearer (`pen`, 15: bigger is stricter about staying close to the outline). For a walk from one place to another the line between the places takes the part of the outline, and the defaults are `snapDist` 80, `corr` 250, `pen` 200. A stop is snapped to the nearest *node* of a way, so a place on a long straight bridge needs `snapDist` raised or a stop at one of its nodes; canals and parks can cut the streets off from each other within `corr`, then raise `corr` (Amsterdam needed 400). |
   | `spur` | Only without `osm`, optional (240): a way out to a place and straight back that is shorter than this many metres in all is cut out, so that a stop in a side street does not send the route there and back; the stop is then up to half of `spur` from the route. Raise it if side trips are too many. |
   | `country`, `tags`, `name`, `place`, `description`, `waypoints` | As in [the package format](https://github.com/walkflow-app/walkflow/blob/main/docs/ROUTE-PACKAGE.md). In a `description`, `{km}` and `{mi}` are replaced by the length of the route (a comma as the decimal sign except in English, Japanese, Chinese and Korean). |
   | `author`, `license`, `source`, `defaultSpeed`, `revision` | Optional: `Walkflow`, `ODbL-1.0`, `© OpenStreetMap contributors (ODbL)`, 4, 1. Raise `revision` when a route that is already in the store changes. |
   | `sources` | Where the facts of the texts come from (addresses). Not written into the package, but kept so the next person can check them. |

3. **Run it** with the app checked out next to this repository (see "How the checks work"), and look at the picture:

   ```
   node scripts/make-route.mjs specs/berlin-schlachtensee.json --preview berlin.svg
   ```

   It prints the length, the number of pieces it could not route, and whether the loop closes. It stops (and writes nothing) if a
   piece could not be routed, the loop does not close, or its length is not within 80 to 120 % of the outline's: look at the picture,
   then change `step`, `snapDist`, `corr` or `pen`. A walk from one place to another stops if a piece could not be routed, a place is
   not within `snapDist` of a street, or the route is more than 1.8 times as long as the straight line between the places (a detour: add
   places to `path`, or lower `corr`); the picture then shows the straight line between the places in grey. `--streets` lists the names
   of the streets the route follows, in order, which is how to see whether it takes the street that is meant (a place without a name
   shows as `(no name)`). `--force` writes anyway. `--dry` writes nothing and needs no app. When it writes the file to `routes/` it runs the store
   check (`build-store.mjs --check --files-only`) on it, so a file that was written has passed it.
4. **Waypoints and texts.** Take the coordinates of a place from OpenStreetMap (the waypoint has to be within 150 m of the route; the
   script says which one is not) and the facts from sources you have read, not from memory. Where sources disagree, say less (a decade
   instead of a year) rather than pick one. A name is up to 80 characters, a waypoint text up to 300, a description up to 1000; a longer
   one is refused. Keep the languages of the existing routes (`en`, `de`, `fr`, `uk`) and have the French and Ukrainian read.
5. **Open a pull request** from a branch with the route file (and its spec): one route per pull request, see "Reviewing a route". The
   spec is in `specs/`, which the one-route rule does not count; `index.json` is written by CI after the merge.

The script asks Nominatim for one outline and Overpass for one area per route and keeps the answers in a folder of the user's
cache (`~/.cache/walkflow-make-route`, or under `$XDG_CACHE_HOME`; `--cache` for another), only readable by the user, so running it again asks
for nothing. Overpass is often busy and answers `502`: the script tries eight times with a growing pause, and running it again later is the
way to go on. OpenStreetMap changes, so a run months later can give a slightly different track from the file in the store; the file in the
store is what counts. `tests/make-route.test.mjs` tests the pieces on a made-up lake, without the network, and
`tests/app-package.test.mjs` checks that what the script writes is what the app itself would write.

## Roadmap

What is being done on the route store, what comes next and what may come later: [ROADMAP.md](ROADMAP.md).

## Support

If the routes are useful to you, you can support the project through [thanks.dev](https://thanks.dev/u/gh/walkflow-app) or
[Ko-fi](https://ko-fi.com/walkflowapp).

## Licence

Every route says under which terms it may be used in its own `license` field. The routes that were added by the project are
track data from [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors, available under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
