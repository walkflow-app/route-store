// The checkout of the app's repository (walkflow-app/walkflow) that some tests need: $WALKFLOW_APP, else ../walkflow. Without one (or
// without `npm ci` done in it) those tests are skipped; the CI of this repository checks the app out and runs them.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = resolve(process.env.WALKFLOW_APP ?? fileURLToPath(new URL('../../walkflow', import.meta.url)));

let esbuild;
try { esbuild = createRequire(join(APP, 'package.json'))('esbuild'); } catch { /* no checkout, or no npm ci */ }
export const hasApp = esbuild !== undefined && existsSync(join(APP, 'src/core/routes/route-package.ts'));
export const skipWithoutApp = hasApp ? false : 'needs a checkout of the app (WALKFLOW_APP) with npm ci done';

/** The app's own code for reading and writing route packages, bundled like scripts/build-store.mjs does */
export async function loadApp() {
  const bundle = await esbuild.build({
    stdin: { contents: "export { readPackage, serializePackage } from './src/core/routes/route-package.ts';", resolveDir: APP, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'warning',
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
