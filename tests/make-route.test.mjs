// scripts/make-route.mjs makes route packages for the route store from OpenStreetMap data. These tests run its pieces on a small
// made-up lake (a square with a path around it); nothing here uses the network. What needs the app's code (is the package one the
// app reads?) is in app-package.test.mjs.

import { describe, it } from 'node:test';
import { expect } from './expect.mjs';
import { buildGraph, checkSpec, collapseSpurs, dropLoops, fillTexts, hav, lengthOf, loopAround, packageText, parseOsm, routeVia, sampleRing, shortestPath, simplify, stopsOf } from '../scripts/make-route.mjs';

const nodeIds = new Map();
const idOf = (p) => { const k = p.join(','); if (!nodeIds.has(k)) nodeIds.set(k, nodeIds.size + 1); return nodeIds.get(k); };
const way = (id, coords, tags = { highway: 'footway' }) =>
  ({ type: 'way', id, tags, nodes: coords.map(idOf), geometry: coords.map(([lat, lon]) => ({ lat, lon })) });

/** The corners of the lake: about 360 m wide and 445 m high */
const CORNERS = [[52.5, 13.4], [52.5, 13.405], [52.504, 13.405], [52.504, 13.4], [52.5, 13.4]];
/** The same square, `grow` degrees bigger, with a point every 0.0002 degrees (about 20 m), as a path in OpenStreetMap has */
function around(grow = 0) {
  const [[s, w],, [n, e]] = CORNERS;
  const d = 0.0002, r = (v) => +v.toFixed(6);
  const pts = [];
  for (let lon = w - grow; lon < e + grow - 1e-9; lon += d) pts.push([r(s - grow), r(lon)]);
  for (let lat = s - grow; lat < n + grow - 1e-9; lat += d) pts.push([r(lat), r(e + grow)]);
  for (let lon = e + grow; lon > w - grow + 1e-9; lon -= d) pts.push([r(n + grow), r(lon)]);
  for (let lat = n + grow; lat > s - grow + 1e-9; lat -= d) pts.push([r(lat), r(w - grow)]);
  pts.push(pts[0]);
  return pts;
}
const OPTS = { corr: 40, pen: 15 };

describe('geometry', () => {
  it('measures a degree of latitude as about 111 km', () => {
    expect(hav([52, 13], [53, 13])).toBeGreaterThan(111000);
    expect(hav([52, 13], [53, 13])).toBeLessThan(111400);
    expect(lengthOf([[52, 13], [52.001, 13], [52.002, 13]])).toBeCloseTo(2 * hav([52, 13], [52.001, 13]), 3);
  });

  it('simplifies a straight line to its ends and keeps a corner', () => {
    expect(simplify([[0, 0], [0, 0.001], [0, 0.002], [0, 0.003]], 1)).toEqual([[0, 0], [0, 0.003]]);
    const corner = simplify([[0, 0], [0, 0.001], [0.001, 0.001]], 1);
    expect(corner).toHaveLength(3);
  });

  it('leaves out a bump smaller than the tolerance and keeps a bigger one', () => {
    const bump = [[0, 0], [0.00002, 0.001], [0, 0.002]]; // 2 m off the line
    expect(simplify(bump, 5)).toHaveLength(2);
    expect(simplify(bump, 1)).toHaveLength(3);
  });

  it('samples a ring from its first point, one point every step', () => {
    const line = [[0, 0], [0, 0.01]]; // 1.11 km
    const pts = sampleRing(line, 250);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual([0, 0]);
    for (let i = 1; i < pts.length; i++) expect(hav(pts[i - 1], pts[i])).toBeGreaterThan(249);
    for (let i = 1; i < pts.length; i++) expect(hav(pts[i - 1], pts[i])).toBeLessThan(251);
  });
});

describe('shortestPath and collapseSpurs', () => {
  const net = { pos: new Map(), adj: new Map([[1, [[2, 1], [3, 5]]], [2, [[3, 1]]], [3, []], [4, []]]) };

  it('takes the cheaper way round', () => {
    expect(shortestPath(net, 1, 3)).toEqual([1, 2, 3]);
  });

  it('says so when there is no way', () => {
    expect(shortestPath(net, 1, 4)).toBeNull();
    expect(shortestPath(net, 3, 1)).toBeNull();
  });

  it('takes out the places where the way goes out and straight back', () => {
    expect(collapseSpurs([1, 2, 3, 2, 4])).toEqual([1, 2, 4]);
    expect(collapseSpurs([1, 2, 1])).toEqual([1]);
    expect(collapseSpurs([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('buildGraph', () => {
  it('keeps the ways near the outline and drops the ones far from it', () => {
    const net = buildGraph([way(1, around()), way(2, around(0.01))], CORNERS, OPTS);
    expect(net.adj.has(idOf(around()[0]))).toBe(true);
    expect(net.adj.has(idOf(around(0.01)[0]))).toBe(false);
  });

  it('keeps only the largest connected part, so no sample is snapped to a stub that leads nowhere', () => {
    const stub = [[52.5019, 13.40201], [52.5019, 13.40221]];
    const net = buildGraph([way(1, around()), way(2, stub)], CORNERS, { corr: 150, pen: 15 });
    expect(net.adj.has(idOf(stub[0]))).toBe(false);
    expect(net.adj.has(idOf(around()[0]))).toBe(true);
  });

  it('makes a road dearer than a path of the same length, and the one further from the outline dearer still', () => {
    const a = [[52.5, 13.4], [52.5, 13.401]];
    const cost = (tags, coords) => buildGraph([way(9, coords, tags)], CORNERS, { corr: 100, pen: 15 }).adj.get(idOf(coords[0])) [0] [1];
    expect(cost({ highway: 'residential' }, a)).toBeGreaterThan(cost({ highway: 'footway' }, a));
    expect(cost({ highway: 'footway' }, [[52.4996, 13.4], [52.4996, 13.401]])).toBeGreaterThan(cost({ highway: 'footway' }, a));
  });

  it('lets a one-way road be walked one way only, and a path both ways', () => {
    const c = [[52.5, 13.4], [52.5, 13.401]];
    const [from, to] = [idOf(c[0]), idOf(c[1])];
    const oneway = buildGraph([way(8, c, { highway: 'residential', oneway: 'yes' })], CORNERS, OPTS);
    expect(oneway.adj.get(from) .map((e) => e[0])).toContain(to);
    expect(oneway.adj.get(to) ?? []).toHaveLength(0);
    const path = buildGraph([way(8, c, { highway: 'footway', oneway: 'yes' })], CORNERS, OPTS);
    expect(path.adj.get(to) .map((e) => e[0])).toContain(from);
  });

  it('leaves out kinds of way it does not know (Overpass is asked for the right ones; this is the second line of defence)', () => {
    const c = [[52.5, 13.4], [52.5, 13.401]];
    for (const tags of [{ highway: 'motorway' }, { highway: 'steps' }, { railway: 'rail' }]) {
      expect(buildGraph([way(7, c, tags)], CORNERS, OPTS).adj.size, JSON.stringify(tags)).toBe(0);
    }
  });
});

describe('loopAround', () => {
  it('lays a closed loop on the path around the lake, as long as the path', () => {
    const path = around(0.0001);
    const net = buildGraph([way(1, path)], CORNERS, OPTS);
    const loop = loopAround(CORNERS, net, { step: 100, snapDist: 40, tol: 2.5 });
    expect(loop.failed).toEqual([]);
    expect(loop.skipped).toBe(0);
    expect(hav(loop.points[0], loop.points[loop.points.length - 1])).toBe(0);
    expect(lengthOf(loop.points)).toBeGreaterThan(lengthOf(CORNERS) * 0.95);
    expect(lengthOf(loop.points)).toBeLessThan(lengthOf(CORNERS) * 1.1);
  });

  it('ignores a dead-end side path that leaves the loop', () => {
    const spur = [[52.5, 13.402], [52.4985, 13.402]];
    const net = buildGraph([way(1, around()), way(2, spur)], CORNERS, { corr: 300, pen: 15 });
    expect(net.adj.has(idOf(spur[1]))).toBe(true);
    const loop = loopAround(CORNERS, net, { step: 100, snapDist: 40, tol: 2.5 });
    expect(Math.min(...loop.points.map((p) => p[0]))).toBeGreaterThan(52.4995);
  });

  it('says so when no path is near enough', () => {
    const net = buildGraph([way(1, around(0.01))], CORNERS, OPTS);
    expect(() => loopAround(CORNERS, net, { step: 100, snapDist: 40, tol: 2.5 })).toThrow(/within 40 m of a path/);
  });
});

describe('routeVia', () => {
  /** A street 1.1 km long going east, with a footpath as a shortcut next to it and a side street that leads nowhere */
  const street = [[52.5, 13.4], [52.5, 13.405], [52.5, 13.41]];
  const side = [[52.5, 13.405], [52.503, 13.405]];
  const STOPS = [[52.5, 13.4], [52.5, 13.405], [52.5, 13.41]];
  const OPT = { snapDist: 40, tol: 2.5 };

  it('goes from the first stop to the last, through the others, and is not a loop', () => {
    const net = buildGraph([way(1, street, { highway: 'pedestrian' }), way(2, side, { highway: 'residential' })], STOPS, { corr: 300, pen: 200 });
    const r = routeVia(STOPS, net, OPT);
    expect(r.failed).toEqual([]);
    expect(r.points[0]).toEqual([52.5, 13.4]);
    expect(r.points[r.points.length - 1]).toEqual([52.5, 13.41]);
    expect(lengthOf(r.points)).toBeGreaterThan(hav(STOPS[0], STOPS[2]) * 0.99);
    expect(lengthOf(r.points)).toBeLessThan(hav(STOPS[0], STOPS[2]) * 1.01);
  });

  it('keeps to the street between the stops even when a stop is a few metres off it', () => {
    const net = buildGraph([way(1, street, { highway: 'pedestrian' })], STOPS, { corr: 300, pen: 200 });
    const r = routeVia([[52.50003, 13.4], [52.49997, 13.41]], net, OPT);
    expect(r.points.every((p) => Math.abs(p[0] - 52.5) < 1e-5)).toBe(true);
  });

  it('says which stop has no path near it, instead of leaving the place out', () => {
    const net = buildGraph([way(1, street, { highway: 'pedestrian' })], STOPS, { corr: 300, pen: 200 });
    expect(() => routeVia([STOPS[0], [52.502, 13.405], STOPS[2]], net, OPT)).toThrow(/Stop 2 .* is not within 40 m of a path/);
  });

  it('refuses a stop on a part of the network that is cut off from the rest, and stops that are one place', () => {
    const net = buildGraph([way(1, street.slice(0, 2), { highway: 'pedestrian' }), way(2, [[52.5002, 13.4052], [52.5002, 13.41]], { highway: 'pedestrian' })],
      STOPS, { corr: 300, pen: 200 });
    // only the larger part of the graph is kept, so the stop on the other part has no path near it
    expect(() => routeVia(STOPS, net, OPT)).toThrow(/not within/);
    expect(() => routeVia([STOPS[0], STOPS[0]], buildGraph([way(1, street, { highway: 'pedestrian' })], STOPS, { corr: 300, pen: 200 }), OPT)).toThrow(/same place/);
  });

  it('cuts out a short way out and back (a stop snapped to a side street), but keeps a long one', () => {
    // nodes 1..6 are on a line 10 m apart; 7 is a side street end
    const pos = new Map ([1, 2, 3, 4, 5, 6, 7].map((id, i) => [id, [52.5, 13.4 + i * 0.00015]]));
    const net = { pos, adj: new Map(), names: new Map() };
    expect(dropLoops([1, 2, 3, 2, 1, 4], net, 240)).toEqual([1, 4]);
    expect(dropLoops([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 7], net, 20)).toEqual([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 7]);
    // the length is measured as it was walked, so a long spur is cut only at its tip (here the last two nodes), not bit by bit all the way
    expect(dropLoops([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 7], net, 60)).toEqual([1, 2, 3, 4, 3, 2, 1, 7]);
    expect(dropLoops([1, 2, 3, 2, 4], net, 240)).toEqual([1, 2, 4]);
  });

  it('takes the stops from "path", else from the waypoints', () => {
    const wp = [{ at: [1, 2], name: { en: 'A' } }, { at: [3, 4], name: { en: 'B' } }];
    expect(stopsOf({ waypoints: wp })).toEqual([[1, 2], [3, 4]]);
    expect(stopsOf({ waypoints: wp, path: [[1, 2], [2, 3], [3, 4]] })).toHaveLength(3);
  });
});

describe('texts and specs', () => {
  it('writes the numbers with a point in English and a comma in most other languages', () => {
    expect(fillTexts({ en: 'About {km} km ({mi} miles)', de: 'Rund {km} km', uk: '{km} км', ja: '{km} km' }, { km: 5.31, mi: 3.3 }))
      .toEqual({ en: 'About 5.3 km (3.3 miles)', de: 'Rund 5,3 km', uk: '5,3 км', ja: '5.3 km' });
  });

  it('reads the id of a relation or a way and nothing else', () => {
    expect(parseOsm('relation/62215')).toEqual({ type: 'relation', id: '62215' });
    expect(parseOsm('way/4317997')).toEqual({ type: 'way', id: '4317997' });
    for (const bad of ['node/1', 'relation/', 'relation/12a', 'https://www.openstreetmap.org/relation/1', '']) expect(() => parseOsm(bad), bad).toThrow();
  });

  const good = () => ({ file: 'test-lake', osm: 'way/1', name: { en: 'Test Lake' }, place: { en: 'Nowhere' }, description: { en: 'About {km} km.' },
    waypoints: [{ at: [52.5, 13.4], name: { en: 'Start' }, text: { en: 'A text.' } }] });

  it('accepts a spec that is in order', () => {
    expect(() => checkSpec(good())).not.toThrow();
  });

  it('refuses a spec with a file name, a language or a text the store would not take', () => {
    const bad = (change, message) => { const s = good(); change(s); expect(() => checkSpec(s)).toThrow(message); };
    bad(s => { s.file = 'Test Lake'; }, /"file"/);
    bad(s => { s.osm = 'node/1'; }, /relation/);
    bad(s => { (s).name = undefined; }, /name needs/);
    bad(s => { s.name = { en: 'x'.repeat(81) }; }, /name.en has 81/);
    bad(s => { s.name = { 'de-CH': 'x' }; }, /not a language code/);
    bad(s => { s.waypoints[0] .text = { en: 'x'.repeat(301) }; }, /text.en has 301/);
    bad(s => { (s.waypoints[0]).at = [52.5]; }, /\.at has to be/);
  });

  it('takes a route from one place to another when there is no "osm", and wants two places for it', () => {
    const via = () => ({ file: 'test-walk', name: { en: 'Test Walk' }, waypoints: [{ at: [52.5, 13.4], name: { en: 'A' } }, { at: [52.5, 13.41], name: { en: 'B' } }] });
    expect(() => checkSpec(via())).not.toThrow();
    const one = via(); one.waypoints.pop();
    expect(() => checkSpec(one)).toThrow(/at least two/);
    const bad = { ...via(), path: [[52.5, 13.4], [52.5]] };
    expect(() => checkSpec(bad)).toThrow(/stop 2 has to be/);
  });
});

describe('packageText', () => {
  const points = CORNERS;
  const spec = {
    file: 'test-lake', osm: 'way/1', country: 'DE', tags: ['lake', 'loop'],
    name: { en: 'Test Lake Loop', de: 'Testsee-Runde' }, place: { en: 'Berlin, Germany', de: 'Berlin, Deutschland' },
    description: { en: 'About {km} km ({mi} miles).', de: 'Rund {km} km.' },
    waypoints: [{ at: [52.5, 13.402], name: { en: 'Shore', de: 'Ufer' }, text: { en: 'A bench.', de: 'Eine Bank.' } }],
  };

  it('refuses a waypoint that is too far from the route, as the store check would', () => {
    const far = { ...spec, waypoints: [{ at: [52.5, 13.4], name: { en: 'Far' } }].map(w => ({ ...w, at: [52.51, 13.4] })) };
    expect(() => packageText(far, points)).toThrow(/"Far" is \d+ m from the route/);
  });

  it('takes author, licence, source, speed and revision from the spec, and has defaults for them', () => {
    const own = JSON.parse(packageText({ ...spec, author: 'Me', license: 'CC0-1.0', source: 'Mine', defaultSpeed: 3, revision: 2 }, points));
    expect([own.author, own.license, own.source, own.defaultSpeed, own.revision]).toEqual(['Me', 'CC0-1.0', 'Mine', 3, 2]);
    const dflt = JSON.parse(packageText(spec, points));
    expect([dflt.author, dflt.license, dflt.source, dflt.defaultSpeed, dflt.revision]).toEqual(['Walkflow', 'ODbL-1.0', '© OpenStreetMap contributors (ODbL)', 4, 1]);
  });
});
