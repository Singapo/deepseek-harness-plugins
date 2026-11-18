import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { audit, canonicalUrl } from '../src/core.js';
import { render } from '../src/report.js';
const fixture = () => JSON.parse(readFileSync(new URL('../examples/brief.json', import.meta.url), 'utf8'));

test('demo distinguishes corroboration metadata, reprints, conflict, forged quote and unsupported claim', () => {
  const report = audit(fixture());
  assert.deepEqual(report.claims.map(c => c.status), ['multiple_origins', 'single_origin', 'conflict', 'needs_review', 'unsupported']);
  assert.equal(report.summary.invalidQuotes, 1);
  assert.equal(report.summary.originGroups, 2);
});
test('original and reprint URLs merge transitively even without matching publisher names', () => {
  const input = fixture();
  input.sources[1].origin = 'different-reprint-label';
  input.sources[2].upstream = input.sources[1].url;
  const report = audit(input);
  assert.equal(report.summary.originGroups, 1);
  assert.equal(report.claims[0].status, 'single_origin');
});
test('identical snapshots cannot count as independent origins', () => {
  const input = fixture(); input.sources[2].content = input.sources[0].content;
  assert.equal(audit(input).summary.originGroups, 1);
});
test('source count deduplicates repeated evidence entries', () => {
  const input = fixture();
  input.claims[0].evidence = [input.claims[0].evidence[0], input.claims[0].evidence[0]];
  const claim = audit(input).claims[0];
  assert.equal(claim.supportingSources, 1);
  assert.equal(claim.supportingOrigins, 1);
});
test('missing source, missing origin and context-only claims are never counted as corroborated', () => {
  const input = fixture();
  input.claims[0].evidence[0].sourceId = 'missing';
  assert.equal(audit(input).claims[0].status, 'needs_review');
  input.sources[2].origin = null;
  assert.equal(audit(input).claims[0].supportingOrigins, 0);
  input.claims[0].evidence = [{ ...input.claims[0].evidence[1], stance: 'context' }];
  assert.equal(audit(input).claims[0].supportingSources, 0);
});
test('quote matching preserves whitespace and snapshot fingerprints', () => {
  const input = fixture();
  input.sources[0].content = '  原文\n引句  ';
  input.claims[0].evidence = [{ sourceId: 'release', quote: '原文\n引句', stance: 'supports' }];
  const report = audit(input);
  assert.equal(report.sources[0].content, '  原文\n引句  ');
  assert.equal(report.sources[0].sha256, createHash('sha256').update(input.sources[0].content).digest('hex'));
  assert.equal(report.claims[0].evidence[0].offset, 2);
  input.claims[0].evidence[0].quote = '原文 引句';
  assert.equal(audit(input).claims[0].evidence[0].valid, false);
});
test('tracking parameters are removed but semantic URL parameters survive', () => {
  assert.equal(canonicalUrl('https://example.org/a?version=2&utm_source=x#top'), 'https://example.org/a?version=2');
  assert.notEqual(canonicalUrl('https://example.org/a?version=2'), canonicalUrl('https://example.org/a?version=3'));
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com']) assert.throws(() => canonicalUrl(url));
});
test('duplicate identifiers, invalid timestamp and unrecognized stance fail', () => {
  const duplicate = fixture(); duplicate.sources.push(duplicate.sources[0]);
  assert.throws(() => audit(duplicate), /Duplicate source/);
  const timestamp = fixture(); timestamp.sources[0].capturedAt = 'yesterday';
  assert.throws(() => audit(timestamp), /ISO timestamp/);
  timestamp.sources[0].capturedAt = '2026-02-30T10:00:00Z';
  assert.throws(() => audit(timestamp), /ISO timestamp/);
  const stance = fixture(); stance.claims[0].evidence[0].stance = 'true';
  assert.throws(() => audit(stance), /stance/);
});
test('pure deterministic audit does not mutate original data', () => {
  const input = fixture(), before = structuredClone(input), report = audit(input);
  assert.deepEqual(input, before);
  assert.deepEqual(audit(input), report);
});
test('HTML escapes source bodies, quotes, labels and JSON script data', () => {
  const input = fixture(); input.sources[0].content += '</script><img src=x onerror=alert(1)>';
  input.label = '<svg onload=alert(1)>';
  const html = render(audit(input));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<svg onload'));
  assert.deepEqual(JSON.parse(html.match(/id="report-data">(.*?)<\/script>/s)[1]).sources[0].content, input.sources[0].content);
});
