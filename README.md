# Walkflow route store

Routes that people contributed to [Walkflow](https://github.com/walkflow-app/walkflow). The app lists them in **Routes → Route
store** and adds a route to the person's library only after they picked it and confirmed. How the app uses the store is
described in [`docs/ROUTE-STORE.md`](https://github.com/walkflow-app/walkflow/blob/main/docs/ROUTE-STORE.md) in the app's repository.

```
index.json          the list the app reads; written by CI after a merge, never by hand
routes/*.walkflow   one route package per file
scripts/            the map of a route for pull requests (see "Reviewing a route")
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
   route goes without opening the file (see [Reviewing a route](https://github.com/walkflow-app/walkflow/blob/main/docs/ROUTE-STORE.md#reviewing-a-route)).

## Changing a route

Edit the file in `routes/` and **raise its `"revision"`** (add `"revision": 2` after `"version": 1` if there is none). People who
have the route get an offer to update it. Keep the file name: it is what identifies the route.

A route in the store is shown to everyone, so a maintainer looks at each pull request before it is merged.

## How the checks work

The checks are the app's own code, so a route that passes is one the app can read. The workflow checks out
[walkflow-app/walkflow](https://github.com/walkflow-app/walkflow) and runs `scripts/build-store.mjs --root <this checkout> --check
--files-only` on a pull request. After a merge to `main` it runs the same script without `--check`, which writes `index.json`, and
commits the result if it changed. A second workflow, `Route preview`, writes the map into the pull request; it never runs code of the
pull request, only reads the route file as text. To try it on your computer, clone both repositories, run `npm ci` in the app's and then
`node scripts/build-store.mjs --root ../route-store --check --files-only` there.

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

## Licence

Every route says under which terms it may be used in its own `license` field. The routes that were added by the project are
track data from [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors, available under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
