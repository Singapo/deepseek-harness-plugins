import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAuthority, worldBankMetric } from '../src/authority.js';
import { runVerification } from '../src/workflow.js';
import { sha256 } from '../src/verify.js';
import { fileURLToPath } from 'node:url';

const now = Date.parse('2026-11-17T00:00:00Z');
const source = { provider: 'worldbank', country: 'CHN', from: 2024, to: 2024 };
export const populationResponse = () => [
  { page: 1, pages: 1, total: 1, sourceid: '2', lastupdated: '2026-11-11' },
  [{ indicator: { id: 'SP.POP.TOTL' }, countryiso3code: 'CHN', date: '2024', value: 1408975000, unit: '', decimal: 0, obs_status: '' }],
];
function mock(data, change = {}) {
  return async url => {
    assert.equal(url, 'https://api.worldbank.org/v2/country/CHN/indicator/SP.POP.TOTL?format=json&per_page=100');
    const response = new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    Object.defineProperties(response, { url: { value: change.url ?? url }, redirected: { value: change.redirected ?? false } });
    return response;
  };
}
test('official mapping ignores caller URL and caller hash; preserves raw provenance', async () => {
  const result = await fetchAuthority({ ...source, url: 'https://evil.invalid', sha256: 'fake' }, { now, fetchImpl: mock(populationResponse()) });
  const row = JSON.parse(result.bytes).rows[0];
  assert.equal(row.metric, worldBankMetric); assert.equal(row.value, '1408975000');
  assert.equal(result.provenance.rawRows[0].countryiso3code, 'CHN');
  assert.match(result.provenance.rawSha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256(Buffer.from(result.provenance.rawResponseUtf8)), result.provenance.rawSha256);
});
test('redirect, wrong host, wrong country, wrong indicator, duplicate, missing and invalid value fail closed', async () => {
  for (const change of [{ url: 'https://evil.invalid' }, { redirected: true }]) {
    await assert.rejects(fetchAuthority(source, { now, fetchImpl: mock(populationResponse(), change) }), { code: 'authority_invalid' });
  }
  for (const mutate of [d => { d[1][0].countryiso3code = 'USA'; }, d => { d[1][0].indicator.id = 'fake'; },
    d => { d[1][0].value = null; }, d => { d[1][0].obs_status = 'F'; },
    d => { d[1].push(d[1][0]); d[0].total = 2; }, d => { d[0].pages = 2; }]) {
    const data = populationResponse(); mutate(data);
    await assert.rejects(fetchAuthority(source, { now, fetchImpl: mock(data) }), { code: 'authority_invalid' });
  }
  const data = populationResponse(); data[1][0].date = '2023';
  await assert.rejects(fetchAuthority(source, { now, fetchImpl: mock(data) }), { code: 'authority_incomplete' });
});
test('fixed freshness policy rejects stale or future releases and network failure has no fallback', async () => {
  for (const date of ['2020-01-01', '2027-01-01']) {
    const data = populationResponse(); data[0].lastupdated = date;
    await assert.rejects(fetchAuthority({ ...source, maxAgeDays: 99999 }, { now, fetchImpl: mock(data) }), { code: 'authority_stale' });
  }
  await assert.rejects(fetchAuthority(source, { now, fetchImpl: async () => { throw new Error('offline'); } }), { code: 'authority_unavailable' });
  await assert.rejects(fetchAuthority({ provider: 'local' }, { now }), { code: 'authority_required' });
});
test('end-to-end authority workflow binds verified output; strict workflow rejects local pinned data', async () => {
  const request = fileURLToPath(new URL('../examples/check-authority.json', import.meta.url));
  const report = await runVerification(request, { now, requireAuthority: true, fetchImpl: mock(populationResponse()) });
  assert.equal(report.gate.status, 'passed'); assert.equal(report.provenance.length, 1);
  assert.match(report.gate.outputSha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256(report.gate.deliverableText), report.gate.outputSha256);
  assert.ok(report.gate.deliverableText.includes(report.provenance[0].rawSha256));
  const failed = await runVerification(request, { now, requireAuthority: true, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(failed.gate.verifiedText, null);
  const local = await runVerification(fileURLToPath(new URL('../examples/check-pass.json', import.meta.url)), { now, requireAuthority: true });
  assert.equal(local.gate.status, 'blocked');
});
