// A route package made by scripts/make-route.mjs has to be one the app reads, and written the way the app writes it (so a route that
// is exported again by the app does not change). Both are the app's code, so these tests need a checkout of the app (tests/app.mjs).

import { describe, it } from 'node:test';
import { expect } from './expect.mjs';
import { loadApp, skipWithoutApp } from './app.mjs';
import { packageText } from '../scripts/make-route.mjs';

const points = [[52.5, 13.4], [52.5, 13.405], [52.504, 13.405], [52.504, 13.4], [52.5, 13.4]];
const spec = {
  file: 'test-lake', osm: 'way/1', country: 'DE', tags: ['lake', 'loop'],
  name: { en: 'Test Lake Loop', de: 'Testsee-Runde' }, place: { en: 'Berlin, Germany', de: 'Berlin, Deutschland' },
  description: { en: 'About {km} km ({mi} miles).', de: 'Rund {km} km.' },
  waypoints: [{ at: [52.5, 13.402], name: { en: 'Shore', de: 'Ufer' }, text: { en: 'A bench.', de: 'Eine Bank.' } }],
};

describe('packageText and the app', { skip: skipWithoutApp }, () => {
  it('is exactly what the app writes for the same package, so a route re-exported by the app does not change', async () => {
    const { serializePackage } = await loadApp();
    const text = packageText(spec, points);
    expect(serializePackage(JSON.parse(text))).toBe(text);
  });

  it('is a package the app reads, with the texts and the waypoint', async () => {
    const { readPackage } = await loadApp();
    const r = readPackage(packageText(spec, points), 'x', 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.route.names).toEqual(spec.name);
    expect(r.route.country).toBe('DE');
    expect(r.route.meta?.license).toBe('ODbL-1.0');
    expect(r.route.waypoints).toHaveLength(1);
    expect(r.route.texts?.en).toMatch(/^About 1\.\d km \(\d\.\d miles\)\.$/);
    expect(r.route.texts?.de).toMatch(/^Rund 1,\d km\.$/);
  });
});
