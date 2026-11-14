# Roadmap

What is being done on the route store, what comes next, and what may come later. The maintainer decides what moves into
*Now*. The app has [its own roadmap](https://github.com/walkflow-app/walkflow/blob/main/ROADMAP.md). Last updated: 2026-11-14.

## Now

- **City walks waiting for review:** Edinburgh, Florence, Munich, Paris, Prague and Rome
  ([open pull requests](https://github.com/walkflow-app/route-store/pulls)).

## Next

- **`main` only through pull requests:** CI pushes `index.json` to `main` directly, which is why the ruleset cannot require
  pull requests yet. Pushing the index with a deploy key (like the app's site) would allow it.
- **More routes:** lake loops in countries the store does not have yet.

## Later, maybe

- **Pictures at waypoints**, served from this repository
  ([the idea](https://github.com/walkflow-app/walkflow/blob/main/docs/ROUTE-STORE.md#later-maybe)); needs the app too.

## Done recently

- 2026-11-13: tooling to make and check routes moved here from the app; one route per pull request, a map of the route on
  every pull request; city walks in Amsterdam, Berlin, Budapest, Copenhagen, Lisbon and Lviv.
