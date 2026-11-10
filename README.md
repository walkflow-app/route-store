# Walkflow route store

Routes that people contributed to [Walkflow](https://github.com/walkflow-app/walkflow). The app lists them in **Routes → Route
store** and adds a route to the person's library only after they picked it and confirmed. How the app uses the store is
described in [`docs/ROUTE-STORE.md`](https://github.com/walkflow-app/walkflow/blob/main/docs/ROUTE-STORE.md) in the app's repository.

```
index.json          the list the app reads; written by CI after a merge, never by hand
routes/*.walkflow   one route package per file
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
4. Open a pull request with the file. **Do not touch `index.json`**: it is written by CI after the merge, from the files.
   CI checks the file and fails if it is not a valid package, has no `license`, has a waypoint far from the route, or is a copy
   of another file.

## Changing a route

Edit the file in `routes/` and **raise its `"revision"`** (add `"revision": 2` after `"version": 1` if there is none). People who
have the route get an offer to update it. Keep the file name: it is what identifies the route.

A route in the store is shown to everyone, so a maintainer looks at each pull request before it is merged.

## How the checks work

The checks are the app's own code, so a route that passes is one the app can read. The workflow checks out
[walkflow-app/walkflow](https://github.com/walkflow-app/walkflow) and runs `scripts/build-store.mjs --root <this checkout> --check
--files-only` on a pull request. After a merge to `main` it runs the same script without `--check`, which writes `index.json`, and
commits the result if it changed. To try it on your computer, clone both repositories, run `npm ci` in the app's and then
`node scripts/build-store.mjs --root ../route-store --check --files-only` there.

## Licence

Every route says under which terms it may be used in its own `license` field. The routes that were added by the project are
track data from [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors, available under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
