// Where the video review's passphrase comes from: --key, then the shell, then Netlify, then a plain failure.
// The Netlify lookup is faked. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReviewKey } from '../scripts/videos-lib.mjs';

const netlify = (value) => { const f = async () => { f.calls += 1; if (value instanceof Error) throw value; return value; }; f.calls = 0; return f; };

test('--key wins over the shell and Netlify, and Netlify is not asked', async () => {
  const n = netlify('from-netlify');
  assert.deepEqual(await resolveReviewKey({ flag: 'from-flag', env: 'from-env', netlify: n }), { key: 'from-flag', source: '--key' });
  assert.equal(n.calls, 0);
});

test('the shell wins over Netlify, and Netlify is not asked', async () => {
  const n = netlify('from-netlify');
  const got = await resolveReviewKey({ flag: '', env: 'from-env', netlify: n });
  assert.equal(got.key, 'from-env');
  assert.match(got.source, /shell/);
  assert.equal(n.calls, 0);
});

test('with neither, the key comes from Netlify', async () => {
  const n = netlify('from-netlify');
  const got = await resolveReviewKey({ flag: undefined, env: undefined, netlify: n });
  assert.equal(got.key, 'from-netlify');
  assert.match(got.source, /Netlify/);
  assert.equal(n.calls, 1);
});

test('Netlify failing is a plain message that names the overrides', async () => {
  await assert.rejects(resolveReviewKey({ flag: '', env: '', netlify: netlify(new Error('the Netlify CLI is not installed')) }),
    (e) => /Netlify could not give/.test(e.message) && /not installed/.test(e.message) && /--key/.test(e.message) && /VIDEO_REVIEW_KEY/.test(e.message));
});

test('Netlify with no value set is a plain failure, never an empty key', async () => {
  for (const value of ['', undefined, null]) {
    await assert.rejects(resolveReviewKey({ flag: '', env: '', netlify: netlify(value) }), /no VIDEO_REVIEW_KEY/);
  }
});
