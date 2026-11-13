// scripts/route-preview.mjs makes the map of a route package for a pull request: Markdown with a geojson block.
// Run: node --test

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MARKER, previewMarkdown, routeGeoJson } from '../scripts/route-preview.mjs';

const pkg = (over = {}) => ({
  format: 'walkflow-route', version: 1, revision: 2,
  name: { de: 'Runde', en: 'Loop' },
  points: [[52.5, 13.4], [52.5, 13.401], [52.501, 13.402]],
  waypoints: [{ at: [52.5, 13.401], name: { en: 'A bridge' }, text: { en: 'A text.' } }],
  ...over,
});
const geojsonOf = md => JSON.parse(/```geojson\n(.*)\n```/s.exec(md)[1]);

describe('routeGeoJson', () => {
  it('writes longitude first, as GeoJSON does, and has the line, a start, a goal and the waypoints', () => {
    const g = routeGeoJson(pkg(), pkg().points);
    assert.equal(g.features.length, 4);
    assert.deepEqual(g.features[0].geometry, { type: 'LineString', coordinates: [[13.4, 52.5], [13.401, 52.5], [13.402, 52.501]] });
    assert.equal(g.features[1].properties.title, 'Start');
    assert.deepEqual(g.features[3].geometry.coordinates, [13.401, 52.5]);
    assert.equal(g.features[3].properties.title, 'A bridge');
    assert.equal(g.features[3].properties.description, 'A text.');
  });

  it('shows the English name, else the first language', () => {
    assert.equal(routeGeoJson(pkg(), pkg().points).features[0].properties.title, 'Loop');
    assert.equal(routeGeoJson(pkg({ name: { fr: 'Boucle' } }), pkg().points).features[0].properties.title, 'Boucle');
  });

  it('leaves out a waypoint whose place cannot be read', () => {
    const g = routeGeoJson(pkg({ waypoints: [{ at: [999, 1], name: { en: 'x' } }, { name: { en: 'y' } }] }), pkg().points);
    assert.equal(g.features.length, 3);
  });
});

describe('previewMarkdown', () => {
  it('starts with the marker the CI finds its comment by, and has a map that is valid JSON', () => {
    const md = previewMarkdown(JSON.stringify(pkg()), { label: 'routes/x.walkflow', commit: 'abcdef1234567890' });
    assert.ok(md.startsWith(`${MARKER}\n`));
    assert.match(md, /`routes\/x\.walkflow`: 0\./);
    assert.ok(md.includes('3 points, 1 waypoint, revision 2'));
    assert.ok(md.includes('commit `abcdef123456`'));
    assert.equal(geojsonOf(md).type, 'FeatureCollection');
  });

  it('cannot be broken out of: a backtick in a text does not end the code block, and a label is only path characters', () => {
    const evil = pkg({ waypoints: [{ at: [52.5, 13.401], name: { en: '```\n[x](http://evil)' }, text: { en: 'a ``` b `c`' } }] });
    const md = previewMarkdown(JSON.stringify(evil), { label: 'routes/x`](http://evil).walkflow' });
    const body = /```geojson\n(.*)\n```/s.exec(md)[1];
    assert.ok(!body.includes('`'));
    assert.equal(JSON.parse(body).features[3].properties.title, '```\n[x](http://evil)');
    assert.doesNotMatch(md.split('\n')[3], /\]\(http/);
    assert.equal(md.match(/```/g).length, 2);
  });

  it('thins out a long route until it fits, and says so', () => {
    const points = Array.from({ length: 4000 }, (_, i) => [52 + i * 0.00001, 13 + Math.sin(i / 20) * 0.0005]);
    const md = previewMarkdown(JSON.stringify(pkg({ points, waypoints: [] })), { maxPoints: 300 });
    const line = geojsonOf(md).features[0].geometry.coordinates;
    assert.ok(line.length <= 300);
    assert.ok(line.length > 10);
    assert.match(md, /4000 points, 0 waypoints.*drawn with \d+ points \(up to \d+ m/);
    assert.ok(md.length < 60000);
  });

  it('says so, with the same first line, when the file is not a route package', () => {
    for (const bad of ['not json', '{}', JSON.stringify(pkg({ format: 'walkflow-workout' })), JSON.stringify(pkg({ points: [[1, 2]] })), JSON.stringify(pkg({ points: [[1, 2], ['a', 3]] }))]) {
      const md = previewMarkdown(bad);
      assert.ok(md.startsWith(`${MARKER}\n`), bad);
      assert.ok(md.includes('could not be read'), bad);
      assert.ok(!md.includes('```geojson'), bad);
    }
  });

  it('measures the length of the route like the app does (about 111 km for a degree of latitude)', () => {
    const md = previewMarkdown(JSON.stringify(pkg({ points: [[52, 13], [53, 13]], waypoints: [] })));
    assert.match(md, /: 111\.\d\d km, 2 points/);
  });
});
