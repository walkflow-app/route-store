// scripts/build-store.mjs is what the CI of this repository runs against the route files, using the app's code for reading route packages
// (tests/app.mjs). These tests run it on copies of a small store in a temporary folder.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { expect } from './expect.mjs';
import { APP, skipWithoutApp } from './app.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/route-store/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/build-store.mjs', import.meta.url));
const FILE = 'central-park-reservoir.walkflow';

let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'route-store-')); cpSync(FIXTURE, root, { recursive: true }); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (...args) => {
  const r = spawnSync('node', [SCRIPT, '--root', root, '--app', APP, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const edit = change => {
  const path = join(root, 'routes', FILE);
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  change(pkg);
  writeFileSync(path, JSON.stringify(pkg));
};

describe('build-store.mjs', { skip: skipWithoutApp }, () => {
  it('writes the index, and the check then agrees', () => {
    rmSync(join(root, 'index.json'), { force: true });
    expect(run().code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')).routes.map(r => r.file)).toEqual([FILE]);
    expect(run('--check').code).toBe(0);
  });

  it('says so when there is no checkout of the app to read the packages with', () => {
    const r = spawnSync('node', [SCRIPT, '--root', root, '--app', join(root, 'nowhere')], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--app/);
  });

  it('fails the check when the index is not up to date, but not with --files-only', () => {
    run();
    edit(pkg => { pkg.revision = 2; });
    const stale = run('--check');
    expect(stale.code).toBe(1);
    expect(stale.out).toMatch(/not up to date/);
    expect(run('--check', '--files-only').code).toBe(0);
  });

  it('fails for a route without a licence', () => {
    edit(pkg => { delete pkg.license; });
    const r = run('--check', '--files-only');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/license/);
  });

  it('fails for a route that is not a valid package', () => {
    writeFileSync(join(root, 'routes', FILE), '{"not":"a route"}');
    const r = run('--check', '--files-only');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not a valid route package/);
  });

  it('fails for a file name the app would not accept, and for a copy of another file', () => {
    cpSync(join(root, 'routes', FILE), join(root, 'routes', 'Copy.walkflow'));
    expect(run('--check', '--files-only').out).toMatch(/file name must be/);
    rmSync(join(root, 'routes', 'Copy.walkflow'));
    cpSync(join(root, 'routes', FILE), join(root, 'routes', 'copy.walkflow'));
    expect(run('--check', '--files-only').out).toMatch(/the same file as/);
  });

  it('fails for a waypoint that is far from the route', () => {
    edit(pkg => { pkg.waypoints = [{ at: [0, 0], name: { en: 'Far away' } }]; });
    const r = run('--check', '--files-only');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/waypoint/);
  });
});
