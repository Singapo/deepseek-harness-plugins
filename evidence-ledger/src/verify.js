import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const maxRows = 10000;
const units = {
  '元': ['CNY', 1n], '万元': ['CNY', 10000n], '亿元': ['CNY', 100000000n],
  '美元': ['USD', 1n], '万美元': ['USD', 10000n], '亿美元': ['USD', 100000000n],
  '人': ['people', 1n], '万人': ['people', 10000n], '%': ['percent', 1n],
};
export const messages = {
  authority_required: '严格模式只接受代码直接取得的官方来源，不接受模型提供的表格或指纹。',
  authority_unavailable: '未能从官方接口取得数据，本次停止交付。', authority_invalid: '官方响应的格式、身份、期间或数值未通过检查。',
  authority_stale: '来源更新日期不符合当前时效要求。', authority_incomplete: '官方响应未覆盖所有指定期间，本次停止交付。',
  source_unavailable: '原始文件未能读取。', source_changed: '文件指纹与选定的基准不一致，请先复核数据版本。',
  source_unpinned: '尚未固定原始文件的 SHA-256，不能放行。', source_invalid: '原始表格格式或数据不符合契约。',
  missing_fact: '找不到对象、期间、指标和单位完全对应的数据。', source_conflict: '同一口径存在不同数值，尚未解决冲突。',
  estimate_only: '输入为估计值，不能作为已披露事实交付。', unsupported_unit: '当前不支持该单位或单位换算。',
  context_mismatch: '计算输入与拟交付结论的对象、期间、指标或单位不一致。',
  period_mismatch: '变动率需要同类期间、较早的基期和较晚的本期。', nonpositive_base: '基期为零或负数，当前规则拒绝计算变动率。',
  value_mismatch: '拟交付数字与依据原始数据重算的结果不符。', invalid_claim: '结论字段、数值或精度不符合契约。',
  unsupported_operation: '当前只支持原值核对和两期变动率。', empty_claims: '没有待核验的数据结论，不能放行。',
};
function text(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\r\n\u0000-\u001f]/u.test(value)) throw new Error('Invalid text');
  return value.trim();
}
function period(value) {
  const p = text(value);
  if (!/^(?:19|20|21)\d{2}(?:-Q[1-4]|-H[12])?$/.test(p)) throw new Error('Invalid period');
  return p;
}
function decimal(value) {
  if (typeof value !== 'string' || !/^-?\d{1,24}(?:\.\d{1,12})?$/.test(value)) throw new Error('Decimal string required');
  const [whole, fraction = ''] = value.split('.');
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}
const equal = (a, b) => a.n * b.d === b.n * a.d;
const baseValue = row => {
  const v = decimal(row.value);
  return { n: v.n * units[row.unit][1], d: v.d };
};
function rounded(value, places) {
  const negative = value.n < 0n;
  const scaled = (negative ? -value.n : value.n) * 10n ** BigInt(places);
  const amount = scaled / value.d + (scaled % value.d * 2n >= value.d ? 1n : 0n);
  const digits = amount.toString().padStart(places + 1, '0');
  return `${negative && amount !== 0n ? '-' : ''}${places ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits}`;
}
const key = row => JSON.stringify([row.entity, row.period, row.metric, units[row.unit]?.[0]]);
function dimensions(raw) {
  return { entity: text(raw.entity), period: period(raw.period), metric: text(raw.metric), unit: text(raw.unit) };
}
function failure(code, status = 'blocked') { throw Object.assign(new Error(messages[code]), { code, status }); }
function safeLabel(value, fallback) { try { return text(value); } catch { return fallback; } }

/** Deterministic checks relative to pinned local snapshots; never a real-world truth certificate. */
export function verifyData(request, snapshots) {
  if (!request || request.schemaVersion !== 2 || !Array.isArray(request.sources) || !Array.isArray(request.claims)
    || request.sources.length > 20 || request.claims.length > 1000) throw new Error('Expected schemaVersion:2, sources[0..20], claims[0..1000]');
  const sourceIds = new Set();
  const globalIssues = [];
  const rows = [];
  const sources = request.sources.map((raw, i) => {
    const id = text(raw?.id);
    if (sourceIds.has(id)) throw new Error(`Duplicate source id: ${id}`);
    sourceIds.add(id);
    const source = { id, title: safeLabel(raw.title, id), path: raw.path, expectedSha256: raw.sha256 ?? null, actualSha256: null, status: 'verified', rows: 0 };
    const issue = code => { source.status = 'blocked'; source.issue = code; globalIssues.push({ sourceId: id, code, message: messages[code] }); };
    const snapshot = snapshots[i];
    if (!snapshot || snapshot.error || !Buffer.isBuffer(snapshot.bytes)) { issue(messages[snapshot?.issue] ? snapshot.issue : 'source_unavailable'); return source; }
    source.actualSha256 = sha256(snapshot.bytes);
    if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.sha256)) { issue('source_unpinned'); return source; }
    if (source.actualSha256 !== raw.sha256.toLowerCase()) { issue('source_changed'); return source; }
    try {
      const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes).replace(/^\uFEFF/, ''));
      if (doc.schemaVersion !== 1 || !Array.isArray(doc.rows) || !doc.rows.length || doc.rows.length > maxRows) throw new Error('Invalid source rows');
      const parsed = doc.rows.map((rawRow, index) => {
        const row = { ...dimensions(rawRow), value: rawRow.value, basis: rawRow.basis, sourceId: id, row: index + 1 };
        decimal(row.value);
        if (!units[row.unit] || !['reported', 'estimate'].includes(row.basis)) throw new Error('Invalid unit or basis');
        return row;
      });
      rows.push(...parsed);
      source.rows = parsed.length;
    } catch { issue('source_invalid'); }
    return source;
  });
  const index = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(row);
  }
  const claimIds = new Set();
  const claims = request.claims.map((raw, i) => {
    const id = text(raw?.id);
    if (claimIds.has(id)) throw new Error(`Duplicate claim id: ${id}`);
    claimIds.add(id);
    const result = { id, entity: safeLabel(raw.entity, '未指定对象'), period: safeLabel(raw.period, '未指定期间'),
      metric: safeLabel(raw.metric, '未指定指标'), unit: safeLabel(raw.unit, '未指定单位'), operation: raw.operation,
      reportedValue: typeof raw.reportedValue === 'string' ? raw.reportedValue : null,
      decimals: raw.decimals, expectedValue: null, evidence: [], status: 'needs_review', reasons: [], formula: null, verifiedText: null };
    try {
      const claim = dimensions(raw);
      if (!units[claim.unit]) failure('unsupported_unit', 'needs_review');
      decimal(raw.reportedValue);
      if (!Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 6) failure('invalid_claim', 'needs_review');
      if (!['value', 'growth'].includes(raw.operation)) failure('unsupported_operation', 'needs_review');
      if (!Array.isArray(raw.inputs) || raw.inputs.length !== (raw.operation === 'value' ? 1 : 2)) failure('invalid_claim', 'needs_review');
      const inputs = raw.inputs.map(ref => {
        const selector = { ...dimensions(ref), sourceId: text(ref.sourceId) };
        if (!units[selector.unit]) failure('unsupported_unit', 'needs_review');
        const candidates = index.get(key(selector)) ?? [];
        const exact = candidates.filter(r => r.sourceId === selector.sourceId && r.unit === selector.unit);
        if (!exact.length) failure('missing_fact');
        const row = exact[0];
        const value = baseValue(row);
        // Compare all loaded snapshots, not just the cherry-picked source reference.
        if (candidates.some(r => !equal(baseValue(r), value))) {
          result.evidence.push(...candidates.map(r => ({ ...r, sourceSha256: sources.find(s => s.id === r.sourceId).actualSha256 })));
          failure('source_conflict');
        }
        if (exact.some(r => r.basis !== 'reported')) failure('estimate_only', 'needs_review');
        result.evidence.push({ ...row, sourceSha256: sources.find(s => s.id === row.sourceId).actualSha256 });
        return row;
      });
      let calculated;
      if (raw.operation === 'value') {
        const row = inputs[0];
        if (row.entity !== claim.entity || row.period !== claim.period || row.metric !== claim.metric
          || units[row.unit][0] !== units[claim.unit][0]) failure('context_mismatch');
        const v = baseValue(row);
        calculated = { n: v.n, d: v.d * units[claim.unit][1] };
        result.formula = `${row.value} ${row.unit} → ${claim.unit}`;
      } else {
        const [before, after] = inputs;
        if (before.entity !== after.entity || before.entity !== claim.entity || before.metric !== after.metric
          || before.metric !== claim.metric || after.period !== claim.period || units[before.unit][0] !== units[after.unit][0]
          || claim.unit !== '%' || before.unit === '%') failure('context_mismatch');
        const granularity = p => p.length === 4 ? 'year' : p.slice(5, 6);
        if (granularity(before.period) !== granularity(after.period) || before.period >= after.period) failure('period_mismatch');
        const a = baseValue(before), b = baseValue(after);
        if (a.n <= 0n) failure('nonpositive_base', 'needs_review');
        calculated = { n: (b.n * a.d - a.n * b.d) * 100n, d: b.d * a.n };
        result.formula = `(${after.value} ${after.unit} − ${before.value} ${before.unit}) ÷ ${before.value} ${before.unit} × 100%；先换算为同一单位`;
      }
      result.expectedValue = rounded(calculated, raw.decimals);
      if (!equal(decimal(raw.reportedValue), decimal(result.expectedValue))) failure('value_mismatch');
      result.status = 'verified';
      result.verifiedText = raw.operation === 'value'
        ? `${claim.entity} ${claim.period} ${claim.metric}：${result.expectedValue} ${claim.unit}。`
        : `${claim.entity} ${claim.metric}从 ${inputs[0].period} 到 ${claim.period} 的变动率：${result.expectedValue}%。`;
    } catch (error) {
      const code = error.code && messages[error.code] ? error.code : 'invalid_claim';
      result.status = error.status ?? 'needs_review';
      result.reasons.push({ code, message: messages[code] });
    }
    return result;
  });
  if (!claims.length) globalIssues.push({ code: 'empty_claims', message: messages.empty_claims });
  const verified = claims.filter(c => c.status === 'verified').length;
  const passed = claims.length > 0 && verified === claims.length && globalIssues.length === 0;
  return { schemaVersion: 2, tool: 'jiaozhen', dataset: safeLabel(request.label, '数据交付前核验'),
    inputSha256: sha256(JSON.stringify(request)),
    gate: { status: passed ? 'passed' : 'blocked', rule: '全部结论核验通过且全部来源检查通过，才生成交付正文。',
      verifiedText: passed ? claims.map(c => c.verifiedText).join('\n') : null },
    summary: { claims: claims.length, sources: sources.length, verified, blocked: claims.filter(c => c.status === 'blocked').length,
      needsReview: claims.filter(c => c.status === 'needs_review').length, sourceIssues: globalIssues.length },
    claims, sources, issues: globalIssues,
    limits: ['通过表示与用户选定并固定指纹的数据快照一致，不表示外部世界的数据绝对真实。',
      '对象、期间、指标、单位和 reported/estimate 均来自结构化源表；仍需核对源表的真实性与抽取质量。',
      '当前只检查原值和两期变动率。交付正文由已核验字段生成，不接收任意自然语言结论。',
      '普通工具只控制自身正文；另启专用严格模式后，由宿主直接核验官方数据并接管流式回复，同时拒绝所有工具调用。'],
  };
}
