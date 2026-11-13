// Puts the map of a route (scripts/route-preview.mjs) into a pull request of the route store, as one comment that is changed on every
// push instead of a new one. The workflow of the route store runs it on `pull_request_target`, which has the right to write comments
// also on a pull request from a fork; so it must never run code of the pull request. It does not: the route file is read through the
// GitHub API as text and only parsed as JSON by this script, which comes from the base branch of this repository, never from the pull request.
//
//   node scripts/route-preview-pr.mjs --repo walkflow-app/route-store --pr 12 --head-repo someone/route-store --head-sha <sha> [--dry]
//
//   --dry   prints the comment instead of writing it
//
// It uses the `gh` command (GITHUB_TOKEN as GH_TOKEN). Exactly one changed route file gives a map; more than one gives a note that a pull
// request takes one route; no route file gives nothing (and changes an old comment to a note, so a map of a file that is gone is not left).

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MARKER, previewMarkdown } from './route-preview.mjs';

const ROUTE_FILE = /^routes\/[a-z0-9._-]+\.walkflow$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const BOT = 'github-actions[bot]';

const note = text => `${MARKER}\n### Route preview\n\n${text}\n`;

/** One JSON object per line, as `gh api --jq '.[]'` writes them */
const lines = out => out.split('\n').filter(Boolean).map(l => JSON.parse(l));

/**
 * `gh(args)` runs the gh command and gives its output. Returns the comment that was written (or would be), or null when there is
 * nothing to say.
 */
export function previewComment({ gh, repo, pr, headRepo, headSha, dry = false }) {
  if (!REPO.test(repo) || !/^\d+$/.test(String(pr)) || !/^[0-9a-f]{40}$/.test(headSha ?? '')) throw new Error('--repo, --pr and --head-sha are needed and have to look right');

  const files = lines(gh(['api', `repos/${repo}/pulls/${pr}/files`, '--paginate', '--jq', '.[] | {status, filename}']));
  const routes = files.filter(f => f.filename.startsWith('routes/'));
  const kept = routes.filter(f => f.status !== 'removed');

  const comments = lines(gh(['api', `repos/${repo}/issues/${pr}/comments`, '--paginate', '--jq', '.[] | {id, body, login: .user.login}']));
  const mine = comments.find(c => c.login === BOT && String(c.body).startsWith(MARKER));

  let body = null;
  if (routes.length > 1) {
    body = note(`This pull request changes ${routes.length} route files. A pull request takes one route, so a review looks at one map and one set of texts: please split it up (the check of this pull request fails until you do).`);
  } else if (kept.length === 1) {
    const file = kept[0].filename;
    if (!ROUTE_FILE.test(file)) {
      body = note('The name of the route file must be lower-case letters, digits, `.`, `_` and `-` and end in `.walkflow`, so there is no map.');
    } else if (!headRepo || !REPO.test(headRepo)) {
      body = note('The branch of this pull request is not there any more, so there is no map.');
    } else {
      let text;
      try { text = gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${headRepo}/contents/${file}?ref=${headSha}`]); } catch { text = null; }
      body = text == null ? note(`\`${file}\` could not be read (it may be bigger than 1 MB), so there is no map.`) : previewMarkdown(text, { label: file, commit: headSha });
    }
  } else if (mine) {
    body = note('This pull request does not change a route file (any more), so there is no map.');
  }
  if (body == null) return null;
  if (dry) return body;
  if (mine) gh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${mine.id}`, '-f', `body=${body}`]);
  else gh(['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '-f', `body=${body}`]);
  return body;
}

function main() {
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const gh = a => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    const body = previewComment({ gh, repo: opt('--repo'), pr: opt('--pr'), headRepo: opt('--head-repo'), headSha: opt('--head-sha'), dry: args.includes('--dry') });
    if (body == null) console.log('No route file changed: nothing to write.');
    else if (args.includes('--dry')) process.stdout.write(body);
    else console.log('Comment written.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
