// Makes a route package for the route store (README, "Making a route from OpenStreetMap") from OpenStreetMap data. The outline of a
// lake or a park is laid onto the paths around it and the pieces are joined by shortest paths, which gives a loop that follows the
// real paths. Name, place, texts and waypoints come from a spec file (specs/*.json, format in the README).
//
//   node scripts/make-route.mjs specs/berlin-schlachtensee.json --app ../walkflow
//
// A spec without "osm" makes a route from one place to another instead of a loop: it goes through the "waypoints" in order (or through
// "path", a list of [lat, lon], when it needs more places to be kept to the streets that are meant), on the paths and streets between them.
//
//   --root <dir>      the route-store checkout (default: this repository): writes <dir>/routes/<file>.walkflow, then runs the store check
//   --app <dir>       the checkout of the app's repository, for that check (default: $WALKFLOW_APP, then ../walkflow; see build-store.mjs)
//   --preview <file>  also writes an SVG: the outline in grey, the route in red, the waypoints in blue (open it in a browser)
//   --streets         (a walk from one place to another) also prints the names of the streets and paths the route follows, in order
//   --dry             writes no package and runs no check (with --preview: only the picture)
//   --force           writes the package even if the route looks wrong (a piece could not be routed, the loop does not close,
//                     its length is far from the outline's)
//   --cache <dir>     where answers of Nominatim and Overpass are kept (default: ~/.cache/walkflow-make-route, or $XDG_CACHE_HOME)
//
// It needs the network (Nominatim for the outline, Overpass for the paths; both are free services: it asks for one outline and one
// area per route, and keeps the answers so a second run asks for nothing). No dependencies; the check at the end needs a checkout of
// the app's repository with `npm ci` done (it uses the app's code to read the package, see build-store.mjs).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UA = 'walkflow-make-route';
/** The most a waypoint may be from the route (WAYPOINT_MAX_OFFSET in the app's src/core/routes/route-waypoints.ts; build-store.mjs fails above it) */
export const WAYPOINT_MAX_OFFSET = 150;
/** Limits of the package format (docs/ROUTE-PACKAGE.md in the app's repository): a longer text is cut by the app, so it is refused here */
const NAME_MAX = 80, TEXT_MAX = 300, DESCRIPTION_MAX = 1000;
/** A loop whose length is outside this part of the outline's length wandered off, or took a shortcut */
const LENGTH_RATIO = [0.8, 1.2];
const CLOSE_MAX = 30;
/** A route through places that is longer than this many times the straight line between the stops took a detour */
const DETOUR_MAX = 1.8;

// ---------------------------------------------------------------- geometry

/** Distance in metres between two [lat, lon] */
export function hav(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export const lengthOf = pts => pts.reduce((s, p, i) => (i ? s + hav(pts[i - 1], p) : 0), 0);

/** Douglas-Peucker: the points that keep the line within `tol` metres of the original */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const kLat = 111320, kLon = 111320 * Math.cos(pts[0][0] * Math.PI / 180);
  const xy = pts.map(p => [p[1] * kLon, p[0] * kLat]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let max = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > max) { max = d; at = i; }
    }
    if (max > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Points along a ring every `step` metres, starting with its first point */
export function sampleRing(ring, step) {
  const out = [ring[0]];
  let acc = 0;
  for (let i = 1; i < ring.length; i++) {
    let a = ring[i - 1], d = hav(a, ring[i]);
    while (acc + d >= step) {
      const t = (step - acc) / d;
      a = [a[0] + (ring[i][0] - a[0]) * t, a[1] + (ring[i][1] - a[1]) * t];
      out.push(a);
      d = hav(a, ring[i]);
      acc = 0;
    }
    acc += d;
  }
  return out;
}

/** A function: distance in metres from a [lat, lon] to the nearest part of the ring */
export function distToLine(line) {
  const k0 = Math.cos(line[0][0] * Math.PI / 180), K = 111320;
  const seg = line.slice(1).map((b, i) => { const a = line[i]; return [a[1] * k0 * K, a[0] * K, b[1] * k0 * K, b[0] * K]; });
  return p => {
    const x = p[1] * k0 * K, y = p[0] * K;
    let best = Infinity;
    for (const [ax, ay, bx, by] of seg) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (d < best) best = d;
    }
    return best;
  };
}

// ---------------------------------------------------------------- the network of paths

/** How much longer than its length a way counts, by kind: paths first, then roads (so the loop prefers a path to a road) */
const WALK = { footway: 1, path: 1, pedestrian: 1, cycleway: 1.05, track: 1.1, living_street: 1.2 };
const ROAD = { service: 1.6, residential: 1.6, unclassified: 1.8, tertiary: 2.2, secondary: 3, primary: 4 };

/** The Overpass query for the ways a person can walk on in a box */
export function networkQuery([s, w, n, e]) {
  const kinds = Object.keys({ ...WALK, ...ROAD }).join('|');
  return `[out:json][timeout:120];way["highway"~"^(${kinds})$"]["foot"!="no"]["access"!~"private|no"]["indoor"!="yes"]["service"!~"parking_aisle|driveway"](${s},${w},${n},${e});out geom;`;
}

/**
 * The graph of the ways (elements of an Overpass answer with `out geom`), cut down to what is within `corr` metres of the ring, with
 * edges the dearer the further from the ring (1 + distance / pen), and to the largest connected part, so that a stub that leads
 * nowhere cannot be snapped to. Returns { pos: Map id → [lat, lon], adj: Map id → [[id, cost]], names: Map "a-b" → name of the way }.
 */
export function buildGraph(elements, ring, { corr, pen }) {
  const pos = new Map(), adj = new Map(), dist = new Map(), names = new Map();
  const near = distToLine(ring);
  const dOf = id => { let v = dist.get(id); if (v === undefined) { v = near(pos.get(id)); dist.set(id, v); } return v; };
  const add = (a, b, c) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push([b, c]); };
  for (const way of elements) {
    if (way.type !== 'way') continue;
    const hw = way.tags?.highway, f = WALK[hw] ?? ROAD[hw];
    if (!f) continue;
    way.nodes.forEach((id, i) => pos.set(id, [way.geometry[i].lat, way.geometry[i].lon]));
    const both = WALK[hw] || way.tags.oneway !== 'yes' || way.tags['oneway:foot'] === 'no' || way.tags.foot === 'yes';
    for (let i = 1; i < way.nodes.length; i++) {
      const a = way.nodes[i - 1], b = way.nodes[i], da = dOf(a), db = dOf(b);
      if (da > corr || db > corr) continue;
      const c = hav(pos.get(a), pos.get(b)) * f * (1 + (da + db) / 2 / pen);
      add(a, b, c);
      if (both) add(b, a, c);
      if (way.tags.name) { names.set(`${a}-${b}`, way.tags.name); names.set(`${b}-${a}`, way.tags.name); }
    }
  }
  const comp = new Set();
  let best = [];
  for (const start of adj.keys()) {
    if (comp.has(start)) continue;
    const members = [start];
    comp.add(start);
    for (let i = 0; i < members.length; i++) for (const [v] of adj.get(members[i]) ?? []) if (!comp.has(v)) { comp.add(v); members.push(v); }
    if (members.length > best.length) best = members;
  }
  const keep = new Set(best);
  for (const id of [...adj.keys()]) if (!keep.has(id)) adj.delete(id);
  return { pos, adj, names };
}

/** The id of the node of the graph nearest to p, if it is within maxDist metres, else null */
export function snap(net, p, maxDist) {
  let best = null, bd = Infinity;
  for (const [id] of net.adj) {
    const q = net.pos.get(id);
    if (Math.abs(q[0] - p[0]) > 0.002 || Math.abs(q[1] - p[1]) > 0.003) continue;
    const d = hav(p, q);
    if (d < bd) { bd = d; best = id; }
  }
  return bd <= maxDist ? best : null;
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** The cheapest way from one node to another as a list of ids, or null if there is none */
export function shortestPath(net, from, to) {
  const dist = new Map([[from, 0]]), prev = new Map(), heap = new Heap();
  heap.push(0, from);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (u === to) break;
    if (d > dist.get(u)) continue;
    for (const [v, c] of net.adj.get(u) ?? []) {
      if (d + c < (dist.get(v) ?? Infinity)) { dist.set(v, d + c); prev.set(v, u); heap.push(d + c, v); }
    }
  }
  if (!dist.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]));
  return path;
}

/** Takes out the places where the way goes out and straight back (A B A becomes A) */
export function collapseSpurs(ids) {
  const out = [];
  for (const id of ids) {
    if (out.length >= 2 && out[out.length - 2] === id) out.pop(); else out.push(id);
  }
  return out;
}

/**
 * The loop along a ring: the ring is sampled every `step` metres, every sample is snapped to the graph (within `snapDist`) and the
 * samples are joined in order by shortest paths, back to the first. `failed` lists the pieces that could not be routed (the loop
 * then has a straight line there, or is not closed), `skipped` is the number of samples with no path nearby.
 */
export function loopAround(ring, net, { step, snapDist, tol }) {
  const samples = sampleRing(ring, step);
  const nodes = [];
  let skipped = 0;
  for (const p of samples) {
    const id = snap(net, p, snapDist);
    if (id == null) { skipped++; continue; }
    if (nodes[nodes.length - 1] !== id) nodes.push(id);
  }
  if (nodes.length < 3) throw new Error(`Only ${nodes.length} of ${samples.length} points of the outline are within ${snapDist} m of a path: raise snapDist and corr`);
  nodes.push(nodes[0]);
  const path = [nodes[0]], failed = [];
  for (let i = 1; i < nodes.length; i++) {
    const seg = shortestPath(net, nodes[i - 1], nodes[i]);
    if (seg) path.push(...seg.slice(1)); else failed.push([net.pos.get(nodes[i - 1]), net.pos.get(nodes[i])]);
  }
  const pts = simplify(collapseSpurs(path).map(id => net.pos.get(id)), tol).map(([a, b]) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6]);
  return { points: pts, samples: samples.length, skipped, failed };
}

/**
 * Takes out the places where the way leaves a node and comes back to it within `maxLen` metres in all (A B C B A becomes A, and so
 * does a short loop round a block). A stop that is snapped to a node in a side street or at the end of a dead end would otherwise
 * send the route there and back; a stop in what is cut out is at most half of `maxLen` from the route. A longer way out and back stays.
 */
export function dropLoops(ids, net, maxLen) {
  // the length of a loop is measured along the way as it was walked, not along what is left of it after cutting out inner loops
  const walked = [0];
  for (let i = 1; i < ids.length; i++) walked[i] = walked[i - 1] + hav(net.pos.get(ids[i - 1]), net.pos.get(ids[i]));
  const out = [], from = [], at = new Map();
  ids.forEach((id, i) => {
    const k = at.get(id);
    if (k !== undefined && walked[i] - walked[from[k]] <= maxLen) {
      for (let j = k + 1; j < out.length; j++) at.delete(out[j]);
      out.length = from.length = k + 1;
      return;
    }
    out.push(id); from.push(i); at.set(id, out.length - 1);
  });
  return out;
}

/**
 * The route through places, from the first to the last (no loop): every stop is snapped to the graph (within `snapDist`) and the
 * stops are joined in order by shortest paths. A stop with no path nearby is an error, because the route would skip a place. `failed`
 * lists the pieces that could not be routed (the route then has a straight line there).
 */
export function routeVia(stops, net, { snapDist, tol, spur = 240 }) {
  const nodes = [];
  stops.forEach((p, i) => {
    const id = snap(net, p, snapDist);
    if (id == null) throw new Error(`Stop ${i + 1} (${p.join(', ')}) is not within ${snapDist} m of a path: move it onto a street, or raise snapDist and corr`);
    if (nodes[nodes.length - 1] !== id) nodes.push(id);
  });
  if (nodes.length < 2) throw new Error('All stops snap to the same place: the route would have no length');
  const path = [nodes[0]], failed = [];
  for (let i = 1; i < nodes.length; i++) {
    const seg = shortestPath(net, nodes[i - 1], nodes[i]);
    if (seg) path.push(...seg.slice(1)); else failed.push([net.pos.get(nodes[i - 1]), net.pos.get(nodes[i])]);
  }
  const ids = dropLoops(path, net, spur), streets = [];
  for (let i = 1; i < ids.length; i++) {
    const n = net.names?.get(`${ids[i - 1]}-${ids[i]}`) ?? '(no name)';
    if (streets[streets.length - 1] !== n) streets.push(n);
  }
  const pts = simplify(ids.map(id => net.pos.get(id)), tol).map(([a, b]) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6]);
  return { points: pts, failed, streets };
}

/** The places a route through places passes, in order: `path` if the spec has one (it may have more places than there are waypoints), else the waypoints */
export const stopsOf = spec => (spec.path ?? (spec.waypoints ?? []).map(w => w.at));

/** The box around some places, `margin` degrees bigger on every side: [south, west, north, east] */
export function boxAround(points, margin) {
  return [Math.min(...points.map(p => p[0])) - margin, Math.min(...points.map(p => p[1])) - margin * 1.6, Math.max(...points.map(p => p[0])) + margin, Math.max(...points.map(p => p[1])) + margin * 1.6];
}

// ---------------------------------------------------------------- the package

/** "relation/62215" or "way/4317997" → { type, id } */
export function parseOsm(text) {
  const m = /^(relation|way)\/(\d+)$/.exec(String(text));
  if (!m) throw new Error(`"osm" has to be relation/<id> or way/<id>, got ${JSON.stringify(text)}`);
  return { type: m[1], id: m[2] };
}

const DOT_LANGS = new Set(['en', 'ja', 'zh', 'ko']);
/** Puts {km} and {mi} into texts, with a decimal point in English and a comma in most other languages */
export function fillTexts(texts, { km, mi }) {
  const out = {};
  for (const [lang, text] of Object.entries(texts)) {
    const num = v => (DOT_LANGS.has(lang) ? v.toFixed(1) : v.toFixed(1).replace('.', ','));
    out[lang] = text.replaceAll('{km}', num(km)).replaceAll('{mi}', num(mi));
  }
  return out;
}

/** Throws if the spec cannot become a package */
export function checkSpec(spec) {
  const problems = [];
  if (!/^[a-z0-9._-]+$/.test(spec.file ?? '')) problems.push('"file" is the file name without .walkflow: lower-case letters, digits, . _ -');
  if (spec.osm !== undefined) {
    try { parseOsm(spec.osm); } catch (e) { problems.push(e.message); }
  } else {
    const stops = stopsOf(spec);
    if (!Array.isArray(stops) || stops.length < 2) problems.push('without "osm" the route goes through places: at least two waypoints (or a "path" of at least two [lat, lon])');
    else stops.forEach((p, i) => { if (!(Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) problems.push(`stop ${i + 1} has to be [lat, lon]`); });
  }
  const langMap = (what, v, max, required) => {
    if (v === undefined && !required) return;
    if (!v || typeof v !== 'object' || !Object.keys(v).length) { problems.push(`${what} needs at least one language`); return; }
    for (const [l, t] of Object.entries(v)) {
      if (!/^[a-z]{2,3}$/.test(l)) problems.push(`${what}: "${l}" is not a language code`);
      if (typeof t !== 'string' || !t.trim()) problems.push(`${what}.${l} is empty`);
      else if (t.length > max) problems.push(`${what}.${l} has ${t.length} characters, the most is ${max}`);
    }
  };
  langMap('name', spec.name, NAME_MAX, true);
  langMap('place', spec.place, NAME_MAX, false);
  langMap('description', spec.description, DESCRIPTION_MAX, false);
  (spec.waypoints ?? []).forEach((w, i) => {
    const ok = Array.isArray(w.at) && w.at.length === 2 && w.at.every(Number.isFinite);
    if (!ok) problems.push(`waypoints[${i}].at has to be [lat, lon]`);
    langMap(`waypoints[${i}].name`, w.name, NAME_MAX, true);
    langMap(`waypoints[${i}].text`, w.text, TEXT_MAX, false);
  });
  if (problems.length) throw new Error(`The spec has problems:\n- ${problems.join('\n- ')}`);
}

/** The text of the package file, written like serializePackage in the app's src/core/routes/route-package.ts (one point per line) */
export function packageText(spec, points) {
  const km = lengthOf(points) / 1000;
  const waypoints = (spec.waypoints ?? []).map(w => ({ at: w.at.map(v => Math.round(v * 1e6) / 1e6), name: w.name, ...(w.text ? { text: w.text } : {}) }));
  for (const w of waypoints) {
    const d = distToLine(points)(w.at);
    if (d > WAYPOINT_MAX_OFFSET) throw new Error(`The waypoint "${Object.values(w.name)[0]}" is ${Math.round(d)} m from the route, the most is ${WAYPOINT_MAX_OFFSET} m`);
  }
  const head = {
    format: 'walkflow-route', version: 1, revision: spec.revision ?? 1,
    name: spec.name,
    ...(spec.place ? { place: spec.place } : {}),
    ...(spec.country ? { country: spec.country } : {}),
    defaultSpeed: spec.defaultSpeed ?? 4,
    ...(spec.tags ? { tags: spec.tags } : {}),
    author: spec.author ?? 'Walkflow', license: spec.license ?? 'ODbL-1.0', source: spec.source ?? '© OpenStreetMap contributors (ODbL)',
    ...(spec.description ? { description: fillTexts(spec.description, { km, mi: km / 1.609344 }) } : {}),
    ...(waypoints.length ? { waypoints } : {}),
  };
  const lines = points.map(p => `    ${JSON.stringify(p).replace(/,/g, ', ')}`);
  const text = JSON.stringify(head, null, 2).replace(/"at": \[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '"at": [$1, $2]');
  return `${text.slice(0, -2)},\n  "points": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

/** A picture to look at before the route goes into the store: the outline in grey, the route in red, the waypoints in blue */
export function previewSvg(ring, points, waypoints = []) {
  const all = [...ring, ...points];
  const la0 = Math.min(...all.map(p => p[0])), la1 = Math.max(...all.map(p => p[0]));
  const lo0 = Math.min(...all.map(p => p[1])), lo1 = Math.max(...all.map(p => p[1]));
  const kx = Math.cos((la0 + la1) / 2 * Math.PI / 180), W = 800, S = W / Math.max((lo1 - lo0) * kx, la1 - la0, 1e-9), H = (la1 - la0) * S;
  const xy = p => [((p[1] - lo0) * kx * S + 10).toFixed(1), ((la1 - p[0]) * S + 10).toFixed(1)];
  const line = pts => pts.map(p => xy(p).join(',')).join(' ');
  const dots = waypoints.map(w => { const [x, y] = xy(w.at); return `<circle cx="${x}" cy="${y}" r="6" fill="#26c"/>`; }).join('');
  const [sx, sy] = xy(points[0]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 20}" height="${(H + 20).toFixed(0)}" style="background:#fff">`
    + `<polyline fill="none" stroke="#9ab" stroke-width="8" stroke-opacity=".5" points="${line(ring)}"/>`
    + `<polyline fill="none" stroke="#d22" stroke-width="2" points="${line(points)}"/>${dots}<circle cx="${sx}" cy="${sy}" r="6" fill="#0a0"/></svg>\n`;
}

// ---------------------------------------------------------------- the network access

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cached(dir, key, get) {
  const file = join(dir, `${createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const v = await get();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
  return v;
}

/** { ring: [[lat, lon]], bbox: [south, west, north, east] } of a relation or way: its longest outer ring */
export async function fetchOutline(osm, cacheDir) {
  const { type, id } = parseOsm(osm);
  const j = await cached(cacheDir, `outline ${osm}`, async () => {
    const res = await fetch(`https://nominatim.openstreetmap.org/lookup?format=jsonv2&polygon_geojson=1&osm_ids=${type[0].toUpperCase()}${id}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);
    return res.json();
  });
  if (!j[0]?.geojson) throw new Error(`Nominatim knows nothing about ${osm}`);
  const g = j[0].geojson;
  const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [g.coordinates];
  const ring = rings.sort((a, b) => b.length - a.length)[0].map(([lon, lat]) => [lat, lon]);
  const [s, n, w, e] = j[0].boundingbox.map(Number);
  return { ring, bbox: [s, w, n, e], rings: rings.length };
}

/** The ways of a box from Overpass, which is often busy: a few tries with a pause that grows */
export async function fetchWays(bbox, cacheDir) {
  const query = networkQuery(bbox);
  return cached(cacheDir, query, async () => {
    for (let i = 1; i <= 8; i++) {
      try {
        const res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(130000),
        });
        const text = await res.text();
        if (res.ok && text.startsWith('{')) return JSON.parse(text);
        console.error(`  Overpass answered ${res.status}, try ${i} of 8`);
      } catch (e) { console.error(`  Overpass: ${e.message}, try ${i} of 8`); }
      await sleep(4000 * i);
    }
    throw new Error('Overpass did not answer, try again later');
  });
}

// ---------------------------------------------------------------- the command

function parseArgs(argv) {
  const o = { spec: undefined, root: undefined, preview: undefined, cache: join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'walkflow-make-route'), dry: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') o.dry = true;
    else if (a === '--force') o.force = true;
    else if (a === '--streets') o.streets = true;
    else if (a === '--root' || a === '--app' || a === '--preview' || a === '--cache') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = v;
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else if (!o.spec) o.spec = a;
    else throw new Error(`Only one spec at a time, got a second: ${a}`);
  }
  if (!o.spec) throw new Error('No spec file given');
  o.root ??= fileURLToPath(new URL('..', import.meta.url));
  return o;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(`${e.message}\nUsage: node scripts/make-route.mjs <spec.json> [--root <route-store checkout>] [--app <walkflow checkout>] [--preview <file.svg>] [--streets] [--dry] [--force] [--cache <dir>]`);
    process.exit(2);
  }
  const spec = JSON.parse(readFileSync(opts.spec, 'utf8'));
  checkSpec(spec);
  const problems = [];
  let ring, route, summary;
  if (spec.osm !== undefined) {
    const outline = await fetchOutline(spec.osm, opts.cache);
    ring = outline.ring;
    if (outline.rings > 1) console.error(`Note: the outline has ${outline.rings} outer rings, only the longest is used`);
    const margin = spec.margin ?? 0.004;
    const { bbox } = outline;
    const ways = await fetchWays([bbox[0] - margin, bbox[1] - margin * 1.6, bbox[2] + margin, bbox[3] + margin * 1.6], opts.cache);
    const net = buildGraph(ways.elements, ring, { corr: spec.corr ?? 60, pen: spec.pen ?? 15 });
    const loop = loopAround(ring, net, { step: spec.step ?? 200, snapDist: spec.snapDist ?? 60, tol: spec.tol ?? 2.5 });
    route = loop.points;
    const length = Math.round(lengthOf(route)), outlineLength = Math.round(lengthOf(ring));
    const closure = Math.round(hav(route[0], route[route.length - 1]));
    summary = `${length} m (outline ${outlineLength} m), ${route.length} points, ${loop.failed.length} pieces not routed, ${loop.skipped} of ${loop.samples} samples without a path, closes within ${closure} m`;
    for (const [a, b] of loop.failed) problems.push(`no way from ${a} to ${b}: a straight line there`);
    if (closure > CLOSE_MAX) problems.push(`the loop does not close (${closure} m)`);
    const ratio = length / outlineLength;
    if (ratio < LENGTH_RATIO[0] || ratio > LENGTH_RATIO[1]) problems.push(`the length is ${Math.round(ratio * 100)}% of the outline's: it wandered off or took a shortcut`);
  } else {
    // a route through places: the grey line in the picture joins the stops, and only ways near it are used
    const stops = stopsOf(spec);
    ring = stops;
    const ways = await fetchWays(boxAround(stops, spec.margin ?? 0.003), opts.cache);
    const net = buildGraph(ways.elements, stops, { corr: spec.corr ?? 250, pen: spec.pen ?? 200 });
    const via = routeVia(stops, net, { snapDist: spec.snapDist ?? 80, tol: spec.tol ?? 2.5, spur: spec.spur ?? 240 });
    route = via.points;
    if (opts.streets) console.log(`Streets: ${via.streets.join(' > ')}`);
    const length = Math.round(lengthOf(route)), straight = Math.round(lengthOf(stops));
    summary = `${length} m (${stops.length} stops, ${straight} m in a straight line), ${route.length} points, ${via.failed.length} pieces not routed`;
    for (const [a, b] of via.failed) problems.push(`no way from ${a} to ${b}: a straight line there`);
    const ratio = length / straight;
    if (ratio > DETOUR_MAX) problems.push(`the route is ${ratio.toFixed(1)} times as long as the straight line between the stops: it took a detour (add stops to \`path\`, or lower corr)`);
  }
  console.log(`${spec.file}: ${summary}`);
  const near = distToLine(route);
  for (const w of spec.waypoints ?? []) {
    const d = near(w.at);
    if (d > WAYPOINT_MAX_OFFSET) problems.push(`the waypoint "${Object.values(w.name)[0]}" is ${Math.round(d)} m from the route, the most is ${WAYPOINT_MAX_OFFSET} m`);
  }

  if (opts.preview) { writeFileSync(opts.preview, previewSvg(ring, route, spec.waypoints)); console.log(`Picture: ${opts.preview}`); }
  if (problems.length) {
    console.error(`Looks wrong:\n- ${problems.join('\n- ')}\nLook at the picture (--preview), then change step, snapDist, corr or pen (or the stops) in the spec${opts.force ? '. Written anyway (--force).' : '.'}`);
    if (!opts.force) process.exit(1);
  }
  if (opts.dry) return;

  const target = join(resolve(opts.root), 'routes', `${spec.file}.walkflow`);
  mkdirSync(join(resolve(opts.root), 'routes'), { recursive: true });
  writeFileSync(target, packageText(spec, route));
  console.log(`Written: ${target}`);
  const check = spawnSync(process.execPath, [fileURLToPath(new URL('./build-store.mjs', import.meta.url)), '--root', resolve(opts.root), ...(opts.app ? ['--app', resolve(opts.app)] : []), '--check', '--files-only'], { encoding: 'utf8' });
  console.log(`${check.stdout}${check.stderr}`.trim());
  process.exit(check.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
