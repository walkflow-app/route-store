---
name: make-route
description: Make new routes for the Walkflow route store from OpenStreetMap - lake loops or city walks from A to B - with facts from real sources, texts in en/de/fr/uk, a preview picture, and one pull request per route. Use when asked for new or more routes, a route for a place, or to change a route made by the project.
---

# Make a route

The instructions are in [README.md → Making a route from OpenStreetMap](../../../README.md#making-a-route-from-openstreetmap);
read them first. This is the order of work and what has gone wrong before.

## Before you start

- The app must be checked out at `../walkflow` with `npm ci` (or pass `--app`, or set `$WALKFLOW_APP`).
- No places given? Default: well-known lakes with a path along the shore, in different countries, that the store does not
  have yet (`ls routes/`). Say which you picked.

## Order of work

1. **Places first.** For a loop: the lake and its OpenStreetMap id. For a city walk (tags `city` and `sights`, 2 to 3 km,
   start ≠ goal): 4 to 6 places in walking order, coordinates from OpenStreetMap or Nominatim.
2. **Facts.** Read the sources (Wikipedia worked, also de.wikipedia) with a fetch tool; write only what you read; put every
   URL into the spec's `sources`. Where sources disagree, say less.
3. **Spec** `specs/<file>.json`, copying a similar one from `specs/`. Texts in en, de, fr, uk for name, place, description and
   waypoints; within the length limits.
4. **Dry run:** `node scripts/make-route.mjs specs/<file>.json --dry` (also checks the 150 m waypoint rule).
5. **Make it with a picture:** `node scripts/make-route.mjs specs/<file>.json --preview <file>.svg`, and look at it (convert to
   PNG with headless Chrome `--screenshot` if needed). For a city walk add `--streets` and check it takes the streets meant.
6. Wrong? Change the spec, not the file: `path` for via points, `spur` against out-and-back side trips, `corr` if canals or
   parks cut the streets apart, a stop on a graph node for a long bridge.
7. **Pull request:** branch `feat/route-<file>`, only `routes/<file>.walkflow` and `specs/<file>.json`, title
   `feat: <name> in <place>`. Never `index.json`. Say that fr and uk are not proofread by a native speaker. Check that the
   preview comment with the map appears on the pull request.

## Known pitfalls

- Overpass answers 502 often; the script retries eight times. Run it again later.
- Parks wander off (Regent's Park, Vondelpark, Tempelhofer Feld failed); lakes with a shore path work.
- A lake in several pieces gives only its largest (Sortedams Sø).
- Some city walks come out above 3 km (Paris, Budapest, Copenhagen, Edinburgh 3.1 to 3.3 km): fine, but say so.
- One route per pull request; CI fails otherwise.
