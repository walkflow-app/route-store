// Makes a map of a route package for a pull request in the route store (README.md, "Reviewing a route"): Markdown with a
// ```geojson block, which GitHub shows as a map on OpenStreetMap in a pull request, an issue or a comment. The route is a red line, the
// start and the goal are green and red markers, the waypoints are blue markers (their name and text are what the marker shows).
//
//   node scripts/route-preview.mjs <route.walkflow> [--label <path to show>] [--commit <sha>] [--max-points <n>]
//
// It reads the package file itself, so what the map shows is what the file says (the CI of the route store runs it on every push to
// a pull request, so the map is never older than the file). The file is not trusted: the text in the answer outside the map is only
// numbers and the label, and inside the map a backtick is written as the escape u0060 so that no text can end the code block.
// No dependencies. Tests: tests/route-preview.test.mjs (`node --test`).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- geometry (the same as in scripts/make-route.mjs of walkflow-app/walkflow)

/** Distance in metres between two [lat, lon] */
function hav(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const lengthOf = pts => pts.reduce((s, p, i) => (i ? s + hav(pts[i - 1], p) : 0), 0);

/** Douglas-Peucker: the points that keep the line within `tol` metres of the original */
function simplify(pts, tol) {
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


// ---------------------------------------------------------------- the map

/** The first line of the answer: the CI finds its own comment by it, to change it instead of writing a new one */
export const MARKER = '<!-- walkflow-route-preview -->';
/** GitHub takes up to 65,536 characters in a comment; this leaves room for the lines around the map */
const COMMENT_MAX = 60000;
const MAX_POINTS = 1500;
const TOLERANCES = [0, 2, 5, 10, 25, 50, 100];

/** The text of a language map: English, else the first one */
const pick = map => (map && typeof map === 'object' ? (typeof map.en === 'string' ? map.en : Object.values(map).find(v => typeof v === 'string')) : undefined) ?? '';

const isPoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
const lonLat = p => [p[1], p[0]];

/** The GeoJSON of a package whose route is `points` (which may be fewer than the package's own) */
export function routeGeoJson(pkg, points) {
  const features = [{
    type: 'Feature',
    properties: { title: pick(pkg.name), stroke: '#d22', 'stroke-width': 3, 'stroke-opacity': 0.9 },
    geometry: { type: 'LineString', coordinates: points.map(lonLat) },
  }];
  features.push({ type: 'Feature', properties: { title: 'Start', 'marker-color': '#0a0', 'marker-symbol': 'circle' }, geometry: { type: 'Point', coordinates: lonLat(points[0]) } });
  features.push({ type: 'Feature', properties: { title: 'Goal', 'marker-color': '#d22', 'marker-symbol': 'circle' }, geometry: { type: 'Point', coordinates: lonLat(points[points.length - 1]) } });
  for (const w of Array.isArray(pkg.waypoints) ? pkg.waypoints.slice(0, 50) : []) {
    if (!w || !isPoint(w.at)) continue;
    features.push({
      type: 'Feature',
      properties: { title: pick(w.name), ...(pick(w.text) ? { description: pick(w.text) } : {}), 'marker-color': '#26c', 'marker-symbol': 'circle' },
      geometry: { type: 'Point', coordinates: lonLat(w.at) },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** JSON in which no text can end a code block */
const safeJson = v => JSON.stringify(v).replaceAll('`', '\\u0060');
/** A label for the line above the map: only what cannot be Markdown */
const safeLabel = s => String(s).replace(/[^A-Za-z0-9._\-/]/g, '_').slice(0, 120);

/**
 * The Markdown for a route package (the text of the file). The route is thinned out (Douglas-Peucker with a growing tolerance) until the
 * answer fits a comment. For a file that cannot be read it says so, with the same first line.
 */
export function previewMarkdown(text, { label = 'route.walkflow', commit, maxPoints = MAX_POINTS } = {}) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { pkg = null; }
  const points = Array.isArray(pkg?.points) ? pkg.points : [];
  if (pkg?.format !== 'walkflow-route' || points.length < 2 || !points.every(isPoint)) {
    return `${MARKER}\n### Route preview\n\n\`${safeLabel(label)}\` could not be read as a route package, so there is no map. The check of this pull request says why.\n`;
  }
  const km = lengthOf(points.map(p => [p[0], p[1]])) / 1000;
  const waypoints = Array.isArray(pkg.waypoints) ? Math.min(pkg.waypoints.length, 50) : 0;
  for (const tol of TOLERANCES) {
    const pts = tol ? simplify(points.map(p => [p[0], p[1]]), tol) : points;
    if (pts.length > maxPoints && tol !== TOLERANCES[TOLERANCES.length - 1]) continue;
    const map = safeJson(routeGeoJson(pkg, pts));
    const thinned = pts.length < points.length ? `, drawn with ${pts.length} points (up to ${tol} m off the file's line)` : '';
    const md = [
      MARKER,
      '### Route preview',
      '',
      `\`${safeLabel(label)}\`: ${km.toFixed(2)} km, ${points.length} points, ${waypoints} waypoint${waypoints === 1 ? '' : 's'}${typeof pkg.revision === 'number' ? `, revision ${pkg.revision}` : ''}${thinned}.`,
      '',
      '```geojson',
      map,
      '```',
      '',
      `${commit ? `Made from the file at commit \`${safeLabel(commit).slice(0, 12)}\`. ` : ''}It is made again on every push to this pull request. Green marker: start, red marker: goal, blue: waypoints (click one for its text).`,
      '',
    ].join('\n');
    if (md.length <= COMMENT_MAX) return md;
  }
  return `${MARKER}\n### Route preview\n\n\`${safeLabel(label)}\`: ${km.toFixed(2)} km, ${points.length} points. The map would be too big for a comment.\n`;
}

function main() {
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!file) {
    console.error('Usage: node scripts/route-preview.mjs <route.walkflow> [--label <path>] [--commit <sha>] [--max-points <n>]');
    process.exit(2);
  }
  process.stdout.write(previewMarkdown(readFileSync(file, 'utf8'), { label: opt('--label') ?? file, commit: opt('--commit'), maxPoints: opt('--max-points') ? Number(opt('--max-points')) : MAX_POINTS }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
