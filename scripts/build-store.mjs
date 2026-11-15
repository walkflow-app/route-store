// Checks the route files of this repository and writes index.json from them (the index is what the app reads, docs/ROUTE-STORE.md in
// the app's repository). The CI runs it on every pull request and after every merge:
//   node scripts/build-store.mjs --app <walkflow checkout>                     writes index.json from the files
//   node scripts/build-store.mjs --app <walkflow checkout> --check             also fails if index.json is not what the build would write
//   node scripts/build-store.mjs --app <walkflow checkout> --check --files-only    checks the files only (a pull request does not write the index)
// What counts as a valid route is decided by the app, not here: the logic (src/core/store/route-index.ts, route-package.ts,
// route-waypoints.ts) is the code of the app's repository, walkflow-app/walkflow, bundled on the fly with its esbuild because it is
// TypeScript with imports Node cannot resolve. So a route that passes is one the app can read. --app defaults to $WALKFLOW_APP, then
// to ../walkflow next to this repository. --root is this repository (the default).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const filesOnly = args.includes('--files-only');
const value = name => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const v = args[at + 1];
  if (!v || v.startsWith('--')) { console.error(`${name} needs a value`); process.exit(2); }
  return v;
};
const root = resolve(value('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const app = resolve(value('--app') ?? process.env.WALKFLOW_APP ?? join(root, '..', 'walkflow'));
if (!existsSync(join(app, 'src/core/store/route-index.ts'))) {
  console.error(`No checkout of the app at ${app}: give --app <walkflow checkout> (git clone https://github.com/walkflow-app/walkflow, then npm ci there) or set WALKFLOW_APP`);
  process.exit(2);
}
let esbuild;
try { esbuild = createRequire(join(app, 'package.json'))('esbuild'); } catch {
  console.error(`esbuild is not installed in ${app}: run npm ci there`);
  process.exit(2);
}
const DIR = `${root}/routes`;
const INDEX = `${root}/index.json`;

const bundle = await esbuild.build({
  stdin: {
    contents: [
      "export * from './src/core/store/route-index.ts';",
      "export { readPackage } from './src/core/routes/route-package.ts';",
      "export { analyzeRoute } from './src/core/routes/routes.ts';",
      "export { placeWaypoints, WAYPOINT_MAX_OFFSET } from './src/core/routes/route-waypoints.ts';",
    ].join('\n'),
    resolveDir: app,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'warning',
});
const { entryFromPackage, serializeIndex, parseIndex, STORE_MAX_ROUTES, readPackage, analyzeRoute, placeWaypoints, WAYPOINT_MAX_OFFSET } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const files = readdirSync(DIR).filter(f => !f.startsWith('.')).sort();
const problems = [];
const entries = [];
const seen = new Map();
for (const file of files) {
  const text = readFileSync(`${DIR}/${file}`, 'utf8');
  const r = await entryFromPackage(file, text);
  if (!r.ok) { problems.push(`${DIR}/${file}: ${r.reason === 'fileName' ? 'the file name must be lower-case letters, digits, "." "_" "-" and end in .walkflow' : `not a valid route package (${r.reason})`}`); continue; }
  // A public repository: whoever contributes a route says under which terms it may be used
  if (!String(JSON.parse(text).license ?? '').trim()) problems.push(`${DIR}/${file}: the package needs a "license" (e.g. "CC0-1.0"), see the README of the route-store repository`);
  // Every waypoint has to be on the route, or the app would leave it out
  const { route } = readPackage(text, 'x', 0);
  const lost = (route.waypoints?.length ?? 0) - placeWaypoints(route, analyzeRoute(route)).length;
  if (lost > 0) problems.push(`${DIR}/${file}: ${lost} waypoint${lost === 1 ? ' is' : 's are'} more than ${WAYPOINT_MAX_OFFSET} m from the route`);
  if (seen.has(r.entry.sha256)) problems.push(`${DIR}/${file}: the same file as ${seen.get(r.entry.sha256)}`);
  seen.set(r.entry.sha256, file);
  entries.push(r.entry);
}
if (entries.length > STORE_MAX_ROUTES) problems.push(`more than ${STORE_MAX_ROUTES} routes`);

const indexText = serializeIndex(entries);
if (!parseIndex(indexText).ok) problems.push('the index written for these files would not be accepted by the app');

if (check && !filesOnly) {
  const have = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : null;
  if (have !== indexText) problems.push(`${INDEX} is not up to date: run build-store.mjs without --check and commit the result`);
}
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
if (!check) writeFileSync(INDEX, indexText);
console.log(`${check ? 'Store is in order' : `Wrote ${INDEX}`}: ${entries.length} route${entries.length === 1 ? '' : 's'}`);
