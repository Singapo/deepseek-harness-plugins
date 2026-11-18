import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
function text(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: expected non-empty string`);
  return value.trim();
}
export function canonicalUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected HTTP(S) URL without credentials');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key.toLowerCase())) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
function unique(items) { return [...new Set(items)]; }

/** Integrity audit, not a semantic truth checker. Stances and origins remain supplied annotations. */
export function audit(input) {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.sources) || !Array.isArray(input.claims)) throw new Error('Expected schemaVersion:1, sources[] and claims[]');
  if (input.sources.length > 1000 || input.claims.length > 10000) throw new Error('At most 1000 sources / 10000 claims');
  const ids = new Set();
  const sources = input.sources.map((raw, i) => {
    const path = `sources[${i}]`;
    const id = text(raw?.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`Duplicate source id ${id}`);
    ids.add(id);
    text(raw.content, `${path}.content`);
    const content = raw.content;
    const capturedAt = text(raw.capturedAt, `${path}.capturedAt`);
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(capturedAt)
      || !Number.isFinite(Date.parse(capturedAt))
      || new Date(`${capturedAt.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== capturedAt.slice(0, 10)) throw new Error(`${path}.capturedAt: ISO timestamp with timezone required`);
    return { id, title: text(raw.title, `${path}.title`), url: canonicalUrl(text(raw.url, `${path}.url`)),
      origin: raw.origin == null ? null : text(raw.origin, `${path}.origin`),
      upstream: raw.upstream == null ? null : canonicalUrl(text(raw.upstream, `${path}.upstream`)),
      capturedAt, content, sha256: sha(content) };
  });
  // Connected components preserve shared lineage even when a reprint is linked indirectly.
  const parent = sources.map((_, i) => i);
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map();
  sources.forEach((source, i) => {
    const keys = [`url:${source.url}`, `hash:${source.sha256}`];
    if (source.origin) keys.push(`origin:${source.origin.toLowerCase()}`);
    if (source.upstream) keys.push(`url:${source.upstream}`);
    for (const key of keys) { if (seen.has(key)) parent[root(i)] = root(seen.get(key)); else seen.set(key, i); }
  });
  sources.forEach((source, i) => { source.originGroup = `origin-${root(i) + 1}`; });
  const byId = new Map(sources.map(source => [source.id, source]));
  const claimIds = new Set();
  const claims = input.claims.map((raw, i) => {
    const path = `claims[${i}]`;
    const id = text(raw?.id, `${path}.id`);
    if (claimIds.has(id)) throw new Error(`Duplicate claim id ${id}`);
    claimIds.add(id);
    const claimText = text(raw.text, `${path}.text`);
    if (!Array.isArray(raw.evidence)) throw new Error(`${path}.evidence: expected array`);
    const evidence = raw.evidence.map((entry, j) => {
      const ep = `${path}.evidence[${j}]`;
      const sourceId = text(entry?.sourceId, `${ep}.sourceId`);
      text(entry.quote, `${ep}.quote`);
      const quote = entry.quote;
      if (!['supports', 'contradicts', 'context'].includes(entry.stance)) throw new Error(`${ep}.stance: supports | contradicts | context`);
      const source = byId.get(sourceId);
      const offset = source ? source.content.indexOf(quote) : -1;
      const valid = !!source && offset >= 0;
      return { sourceId, quote, stance: entry.stance, valid, offset: valid ? offset : null,
        originGroup: source?.originGroup ?? null,
        issue: !source ? 'source_missing' : offset < 0 ? 'quote_not_found' : !source.origin ? 'origin_unspecified' : null };
    });
    const valid = evidence.filter(e => e.valid);
    const supports = valid.filter(e => e.stance === 'supports');
    const contradicts = valid.filter(e => e.stance === 'contradicts');
    const supportGroups = unique(supports.filter(e => byId.get(e.sourceId).origin).map(e => e.originGroup));
    const reasons = unique(evidence.filter(e => e.issue).map(e => e.issue));
    if (!supports.length) reasons.push('no_valid_support');
    if (supports.length > supportGroups.length && supportGroups.length > 0) reasons.push('support_not_independent_or_origin_unknown');
    const status = supports.length && contradicts.length ? 'conflict'
      : evidence.some(e => e.issue) ? 'needs_review'
      : !supports.length ? 'unsupported'
      : supportGroups.length < 2 ? 'single_origin' : 'multiple_origins';
    return { id, text: claimText, status, reasons, evidence,
      supportingOrigins: supportGroups.length, supportingSources: unique(supports.map(e => e.sourceId)).length,
      contradictingSources: unique(contradicts.map(e => e.sourceId)).length };
  });
  return { schemaVersion: 1, tool: 'evidence-ledger', dataset: typeof input.label === 'string' ? input.label : 'Untitled research annotations',
    inputSha256: sha(JSON.stringify(input)),
    summary: { claims: claims.length, sources: sources.length, originGroups: unique(sources.map(s => s.originGroup)).length,
      statuses: Object.fromEntries(['conflict', 'needs_review', 'unsupported', 'single_origin', 'multiple_origins'].map(status => [status, claims.filter(c => c.status === status).length])),
      invalidQuotes: claims.reduce((n, c) => n + c.evidence.filter(e => !e.valid).length, 0) },
    claims, sources,
    limits: ['引句匹配只检查原文快照中有没有这段文字，不验证内容是否为真，也不判断引句是否支持结论。',
      '原始来源与支持、反驳关系由人或 Agent 标注，需要人工复核；多个来源链不是可信度评分。',
      '本工具不自动抓取网页。提交的快照时间、正文与源头信息未经外部认证。'],
  };
}
