import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze } from '../src/core.js';
import { render } from '../src/report.js';

const fixture = () => {
  const input = JSON.parse(readFileSync(new URL('../examples/tasks.json', import.meta.url), 'utf8'));
  input.tasks = input.tasks.slice(0, 2);
  return input;
};
test('first-pass and final outcomes expose rework on the same task population', () => {
  const report = analyze(fixture());
  assert.equal(report.summary.final.rate, 1);
  assert.equal(report.summary.firstPass.rate, 0.5);
  assert.equal(report.summary.recovered, 1);
  assert.equal(report.summary.corrections.total, 2);
  assert.equal(report.tasks.length, 2);
});
test('absent annotations remain unknown, including zero corrections', () => {
  const input = fixture();
  input.tasks.push({ id: 'unknown', goal: '未完成标注', project: 'test' });
  const s = analyze(input).summary;
  assert.equal(s.final.known, 2);
  assert.equal(s.final.unknown, 1);
  assert.equal(s.final.coverage, 2 / 3);
  assert.equal(s.corrections.unknown, 1);
  assert.equal(s.corrections.mean, 1);
});
test('unsupported annotations are downgraded to unknown rather than counted', () => {
  const input = fixture();
  input.tasks[0].final.evidence = [];
  input.tasks[0].corrections.evidence = [];
  const report = analyze(input);
  assert.equal(report.tasks[0].final, 'unknown');
  assert.equal(report.tasks[0].corrections, null);
  assert.equal(report.summary.recovered, 0);
  assert.equal(report.summary.needsReview, 1);
});
test('different known populations do not create a false paired comparison', () => {
  const input = fixture();
  delete input.tasks[0].final;
  delete input.tasks[1].firstPass;
  const s = analyze(input).summary;
  assert.equal(s.paired, 0);
  assert.equal(s.pairedFinalRate, null);
  assert.equal(s.pairedFirstPassRate, null);
});
test('duplicates and contradictory outcomes are rejected', () => {
  const input = fixture();
  input.tasks.push(input.tasks[0]);
  assert.throws(() => analyze(input), /duplicate task/);
  const other = fixture();
  other.tasks[1].final.value = 'fail';
  assert.throws(() => analyze(other), /conflicts/);
});
test('malformed correction counts and evidence fail clearly', () => {
  for (const value of [-1, 1.2, '2', Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture(); input.tasks[0].corrections.value = value;
    assert.throws(() => analyze(input), /non-negative integer/);
  }
  const input = fixture(); input.tasks[0].final.evidence = [{ ref: 'x', note: '' }];
  assert.throws(() => analyze(input), /non-empty/);
});
test('empty population yields null rates, deterministic fingerprint and no mutation', () => {
  const input = { schemaVersion: 1, tasks: [] };
  const before = structuredClone(input);
  const report = analyze(input);
  assert.equal(report.summary.final.rate, null);
  assert.equal(report.summary.corrections.mean, null);
  assert.deepEqual(input, before);
  assert.deepEqual(analyze(input), report);
});
test('report escapes untrusted goals and embedded JSON', () => {
  const input = fixture(); input.tasks[0].goal = '</script><img src=x onerror=alert(1)>';
  const html = render(analyze(input));
  assert.ok(!html.includes('<img src=x'));
  const data = html.match(/id="report-data">(.*?)<\/script>/s)[1];
  assert.equal(JSON.parse(data).tasks[0].goal, input.tasks[0].goal);
});
test('recovered tasks still match recovery filter when correction annotations are missing', () => {
  const input = fixture(); delete input.tasks[0].corrections;
  const html = render(analyze(input));
  assert.ok(html.includes('data-status="review recovered"'));
});
