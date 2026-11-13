// scripts/route-preview-pr.mjs writes the map of a route into a pull request, as one comment that is changed on every push. These tests
// give it a fake `gh` that answers like the GitHub API and records what is written; nothing here uses the network.
// Run: node --test

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { previewComment } from '../scripts/route-preview-pr.mjs';
import { MARKER } from '../scripts/route-preview.mjs';

const SHA = 'a'.repeat(40);
const PKG = JSON.stringify({ format: 'walkflow-route', version: 1, name: { en: 'X' }, points: [[52.5, 13.4], [52.5, 13.41]], waypoints: [] });

function fake({ files, comments = [], content = PKG }) {
  const writes = [];
  const gh = args => {
    const url = args.find(a => a.startsWith('repos/')) ?? '';
    if (args.includes('-X')) { writes.push(args); return ''; }
    if (url.includes('/pulls/')) return files.map(f => JSON.stringify(f)).join('\n');
    if (url.includes('/issues/') && url.endsWith('/comments')) return comments.map(c => JSON.stringify(c)).join('\n');
    if (url.includes('/contents/')) { if (content == null) throw new Error('404'); return content; }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { gh, writes };
}
const run = (f, over = {}) => previewComment({ gh: f.gh, repo: 'walkflow-app/route-store', pr: 7, headRepo: 'someone/route-store', headSha: SHA, ...over });

describe('previewComment', () => {
  it('writes a new comment with the map when one route file is new', () => {
    const f = fake({ files: [{ status: 'added', filename: 'routes/a.walkflow' }, { status: 'modified', filename: 'README.md' }] });
    const body = run(f);
    assert.ok(body.startsWith(MARKER));
    assert.ok(body.includes('```geojson'));
    assert.ok(body.includes(`commit \`${SHA.slice(0, 12)}\``));
    assert.equal(f.writes.length, 1);
    assert.ok(f.writes[0].includes('POST'));
    assert.ok(f.writes[0].includes('repos/walkflow-app/route-store/issues/7/comments'));
  });

  it('changes the comment of the bot instead of writing a second one, and ignores a comment that only looks like it', () => {
    const f = fake({
      files: [{ status: 'modified', filename: 'routes/a.walkflow' }],
      comments: [{ id: 1, body: `${MARKER}\nfaked`, login: 'someone' }, { id: 2, body: 'a review comment', login: 'github-actions[bot]' }, { id: 3, body: `${MARKER}\nold map`, login: 'github-actions[bot]' }],
    });
    run(f);
    assert.equal(f.writes.length, 1);
    assert.ok(f.writes[0].includes('PATCH'));
    assert.ok(f.writes[0].includes('repos/walkflow-app/route-store/issues/comments/3'));
  });

  it('says that a pull request takes one route when it changes several, also when one of them is removed', () => {
    for (const files of [
      [{ status: 'added', filename: 'routes/a.walkflow' }, { status: 'added', filename: 'routes/b.walkflow' }],
      [{ status: 'added', filename: 'routes/a.walkflow' }, { status: 'removed', filename: 'routes/b.walkflow' }],
    ]) {
      const body = run(fake({ files }));
      assert.ok(body.includes('changes 2 route files'));
      assert.ok(!body.includes('```geojson'));
    }
  });

  it('writes nothing for a pull request without a route file, unless there is an old map to take back', () => {
    const files = [{ status: 'modified', filename: 'README.md' }];
    const none = fake({ files });
    assert.equal(run(none), null);
    assert.equal(none.writes.length, 0);
    const old = fake({ files, comments: [{ id: 5, body: `${MARKER}\nold map`, login: 'github-actions[bot]' }] });
    assert.ok(run(old).includes('does not change a route file'));
    assert.ok(old.writes[0].includes('PATCH'));
  });

  it('does not read a file whose name it does not know, and says so when the file cannot be read', () => {
    const odd = fake({ files: [{ status: 'added', filename: 'routes/A b.walkflow' }] });
    assert.ok(run(odd).includes('The name of the route file'));
    const gone = fake({ files: [{ status: 'added', filename: 'routes/a.walkflow' }], content: null });
    assert.ok(run(gone).includes('could not be read'));
    assert.ok(run(fake({ files: [{ status: 'added', filename: 'routes/a.walkflow' }] }), { headRepo: null }).includes('not there any more'));
  });

  it('writes nothing with --dry, and refuses input that does not look right', () => {
    const f = fake({ files: [{ status: 'added', filename: 'routes/a.walkflow' }] });
    assert.ok(run(f, { dry: true }).includes('```geojson'));
    assert.equal(f.writes.length, 0);
    assert.throws(() => run(f, { pr: '7; rm -rf' }), /look right/);
    assert.throws(() => run(f, { repo: 'a b' }), /look right/);
    assert.throws(() => run(f, { headSha: 'main' }), /look right/);
  });
});
