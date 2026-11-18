import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyData, sha256 } from '../src/verify.js';
import { runVerification, within } from '../src/workflow.js';
import { renderVerification } from '../src/verify-report.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = (name = 'check-pass.json') => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const bytes = () => readFileSync(new URL('../examples/data/disclosure.json', import.meta.url));
const run = request => verifyData(request, [{ bytes: bytes() }]);
function sourceRows(request, mutate) {
  const doc = JSON.parse(bytes()); mutate(doc.rows);
  const content = Buffer.from(JSON.stringify(doc));
  request.sources[0].sha256 = sha256(content);
  return [{ bytes: content }];
}

test('wrong number, company, period and unsupported forecast close the entire delivery gate', () => {
  const report = run(fixture('check.json'));
  assert.deepEqual(report.claims.map(c => c.status), ['verified', 'blocked', 'blocked', 'blocked', 'needs_review']);
  assert.equal(report.claims[1].expectedValue, '20.00');
  assert.equal(report.claims[1].reasons[0].code, 'value_mismatch');
  assert.equal(report.gate.status, 'blocked');
  assert.equal(report.gate.verifiedText, null);
});
test('fixed claims release only deterministic text with raw-row and file-hash evidence', () => {
  const request = fixture(), before = structuredClone(request), report = run(request);
  assert.equal(report.gate.status, 'passed');
  assert.equal(report.gate.verifiedText, '示例水泥 2024 营业收入：120.00 万元。\n示例水泥 营业收入从 2023 到 2024 的变动率：20.00%。');
  assert.equal(report.claims[0].evidence[0].row, 2);
  assert.equal(report.claims[0].evidence[0].sourceSha256, sha256(bytes()));
  assert.deepEqual(request, before);
  assert.deepEqual(run(request), report);
});
test('cross-unit values convert exactly and currencies cannot be mixed', () => {
  const request = fixture(); request.claims = [request.claims[0]];
  request.claims[0].unit = '亿元'; request.claims[0].reportedValue = '0.012'; request.claims[0].decimals = 3;
  assert.equal(run(request).gate.status, 'passed');
  request.claims[0].unit = '美元';
  assert.equal(run(request).claims[0].reasons[0].code, 'context_mismatch');
});
test('decimal arithmetic and half-away-from-zero rounding avoid binary floating errors', () => {
  const request = fixture();
  request.claims[0].reportedValue = '1.01';
  const snapshots = sourceRows(request, rows => { rows[0].value = '1'; rows[0].unit = '万元'; rows[1].value = '1.005'; });
  request.claims[1].inputs[0].unit = '万元'; request.claims[1].reportedValue = '0.5';
  assert.equal(verifyData(request, snapshots).gate.status, 'passed');
  request.claims = [request.claims[0]]; request.claims[0].reportedValue = '-1.01';
  assert.equal(verifyData(request, sourceRows(request, rows => { rows[1].value = '-1.005'; })).gate.status, 'passed');
  request.claims[0].reportedValue = '-1.005';
  assert.equal(verifyData(request, sourceRows(request, rows => { rows[1].value = '-1.005'; })).claims[0].reasons[0].code, 'value_mismatch');
});
test('changed, absent and malformed source pins close the gate', () => {
  for (const hash of ['0'.repeat(64), undefined, 'not-a-hash']) {
    const request = fixture(); request.sources[0].sha256 = hash;
    const report = run(request);
    assert.equal(report.gate.status, 'blocked');
    assert.equal(report.summary.sourceIssues, 1);
  }
  const report = verifyData(fixture(), [{ bytes: Buffer.concat([bytes(), Buffer.from(' ')]) }]);
  assert.equal(report.sources[0].issue, 'source_changed');
});
test('conflicting rows across any loaded source block cherry-picking; equivalent units do not', () => {
  const request = fixture(); request.claims = [request.claims[0]];
  const doc = JSON.parse(bytes()); doc.rows[1].unit = '元'; doc.rows[1].value = '1200000';
  const content = Buffer.from(JSON.stringify(doc));
  request.sources.push({ id: 'other', path: 'other.json', sha256: sha256(content) });
  assert.equal(verifyData(request, [{ bytes: bytes() }, { bytes: content }]).gate.status, 'passed');
  doc.rows[1].value = '1200001';
  const conflict = Buffer.from(JSON.stringify(doc)); request.sources[1].sha256 = sha256(conflict);
  const report = verifyData(request, [{ bytes: bytes() }, { bytes: conflict }]);
  assert.equal(report.claims[0].reasons[0].code, 'source_conflict');
  assert.equal(report.claims[0].evidence.length, 2);
  assert.equal(report.gate.verifiedText, null);
});
test('unknown data, estimates and malformed source rows cannot become disclosed facts', () => {
  const request = fixture();
  assert.equal(verifyData(request, sourceRows(request, rows => { rows[1].basis = 'estimate'; })).claims[0].status, 'needs_review');
  assert.equal(verifyData(request, sourceRows(request, rows => { rows[1].value = 'NaN'; })).sources[0].issue, 'source_invalid');
  assert.equal(verifyData(request, sourceRows(request, rows => { rows[1].value = 120; })).sources[0].issue, 'source_invalid');
  request.claims[0].inputs[0].metric = '净利润';
  assert.equal(run(request).claims[0].reasons[0].code, 'missing_fact');
});
test('zero or negative growth base and reversed or mixed periods never release a percentage', () => {
  for (const base of ['0', '-1']) {
    const request = fixture();
    assert.equal(verifyData(request, sourceRows(request, rows => { rows[0].value = base; })).claims[1].reasons[0].code, 'nonpositive_base');
  }
  const request = fixture();
  request.claims[1].period = '2023'; request.claims[1].inputs.reverse();
  assert.equal(run(request).claims[1].reasons[0].code, 'period_mismatch');
  const mixed = fixture(); mixed.claims[1].inputs[0].period = '2023-H2';
  assert.equal(verifyData(mixed, sourceRows(mixed, rows => { rows[0].period = '2023-H2'; })).claims[1].reasons[0].code, 'period_mismatch');
});
test('empty claims, unreferenced bad source and unsupported fields cannot accidentally pass', () => {
  const request = fixture(); request.claims = [];
  assert.equal(run(request).gate.status, 'blocked');
  const extra = fixture(); extra.sources.push({ id: 'missing', path: 'missing.json', sha256: '0'.repeat(64) });
  assert.equal(run(extra).gate.status, 'blocked');
  for (const value of [NaN, 'Infinity', '1e2', '', null]) {
    const input = fixture(); input.claims[0].reportedValue = value;
    assert.equal(run(input).gate.status, 'blocked');
  }
  const duplicate = fixture(); duplicate.claims.push(duplicate.claims[0]);
  assert.throws(() => run(duplicate), /Duplicate claim/);
});
test('HTML escapes labels, evidence and embedded report JSON', () => {
  const request = fixture(); request.label = '</script><img src=x onerror=alert(1)>';
  const report = run(request), html = renderVerification(report);
  assert.ok(!html.includes('<img src=x'));
  assert.deepEqual(JSON.parse(html.match(/id="report-data">(.*?)<\/script>/s)[1]), report);
});

test('file workflow and CLI enforce pins, local boundaries and stale-delivery invalidation', async () => {
  const temporaryRoot = join(root, '.tmp'); await mkdir(temporaryRoot, { recursive: true });
  const temp = await mkdtemp(join(temporaryRoot, 'verify-'));
  const inputDir = join(temp, 'input'), output = join(temp, 'output');
  const input = join(inputDir, 'check.json'), data = join(inputDir, 'data.json');
  let link;
  try {
    await mkdir(inputDir); await writeFile(data, bytes());
    const request = fixture(); request.sources[0].path = 'data.json';
    await writeFile(input, JSON.stringify(request));
    assert.equal((await runVerification(input)).gate.status, 'passed');
    const cli = path => spawnSync(process.execPath, ['bin/verify.js', path, '--out', output], { cwd: root, encoding: 'utf8' });
    assert.equal(cli(input).status, 0);
    assert.ok((await readFile(join(output, 'verified.md'), 'utf8')).includes('20.00%'));
    await writeFile(join(output, '.jiaozhen.lock'), 'another run');
    assert.equal(cli(input).status, 1);
    await rm(join(output, '.jiaozhen.lock'));
    await writeFile(data, Buffer.concat([bytes(), Buffer.from(' ')]));
    assert.equal(cli(input).status, 2);
    assert.ok(!(await readFile(join(output, 'verified.md'), 'utf8')).includes('20.00%'));
    await writeFile(data, bytes()); assert.equal(cli(input).status, 0);
    assert.equal(cli(join(inputDir, 'missing.json')).status, 1);
    assert.ok(!(await readFile(join(output, 'verified.md'), 'utf8')).includes('20.00%'));
    assert.equal(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')).gate.status, 'blocked');
    await writeFile(input, '{invalid'); assert.equal(cli(input).status, 1);
    for (const path of ['../outside.json', data]) {
      request.sources[0].path = path; await writeFile(input, JSON.stringify(request));
      assert.equal((await runVerification(input)).sources[0].issue, 'source_unavailable');
    }
    // A resolved directory junction must not escape the authorized source tree.
    const outside = join(temp, 'outside'); await mkdir(outside); await writeFile(join(outside, 'data.json'), bytes());
    link = join(inputDir, 'linked'); await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    request.sources[0].path = 'linked/data.json'; await writeFile(input, JSON.stringify(request));
    assert.equal((await runVerification(input)).sources[0].issue, 'source_unavailable');
    await assert.rejects(runVerification(input, { signal: AbortSignal.abort() }), /abort/i);
  } finally {
    if (link) await rm(link, { force: true, recursive: true });
    assert.ok(within(temporaryRoot, temp) && temp !== temporaryRoot);
    await rm(temp, { recursive: true, force: true });
  }
});
