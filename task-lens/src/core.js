import { createHash } from 'node:crypto';

const outcomes = ['pass', 'fail', 'unknown'];
function text(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: expected non-empty string`);
  return value.trim();
}
function evidence(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path}: expected evidence array`);
  return value.map((item, i) => ({
    ref: text(item?.ref, `${path}[${i}].ref`),
    note: text(item?.note, `${path}[${i}].note`),
  }));
}
function metric(rows, field) {
  const known = rows.filter(t => t[field] !== 'unknown');
  const passed = known.filter(t => t[field] === 'pass').length;
  return { passed, known: known.length, unknown: rows.length - known.length,
    rate: known.length ? passed / known.length : null, coverage: rows.length ? known.length / rows.length : null };
}

/** Explicit task annotations only. No sentiment classifier or implicit success inference. */
export function analyze(input) {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.tasks)) throw new Error('Expected schemaVersion: 1 and tasks[]');
  if (input.tasks.length > 10000) throw new Error('At most 10000 tasks');
  const ids = new Set();
  const tasks = input.tasks.map((raw, i) => {
    const path = `tasks[${i}]`;
    if (!raw || typeof raw !== 'object') throw new Error(`${path}: expected task`);
    const id = text(raw.id, `${path}.id`);
    if (ids.has(id)) throw new Error(`${path}: duplicate task id ${id}`);
    ids.add(id);
    const row = { id, goal: text(raw.goal, `${path}.goal`), project: text(raw.project, `${path}.project`),
      model: raw.model == null ? 'unspecified' : text(raw.model, `${path}.model`),
      harness: raw.harness == null ? 'unspecified' : text(raw.harness, `${path}.harness`) };
    row.evidence = {};
    row.warnings = [];
    for (const field of ['final', 'firstPass']) {
      const annotation = raw[field];
      const value = annotation?.value ?? 'unknown';
      if (!outcomes.includes(value)) throw new Error(`${path}.${field}.value: pass | fail | unknown`);
      const refs = evidence(annotation?.evidence ?? [], `${path}.${field}.evidence`);
      row[field] = value;
      row.evidence[field] = refs;
      if (value !== 'unknown' && refs.length === 0) {
        row[field] = 'unknown';
        row.warnings.push(`${field}: missing evidence; treated as unknown`);
      }
    }
    const count = raw.corrections?.value ?? null;
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) throw new Error(`${path}.corrections.value: non-negative integer or null`);
    row.evidence.corrections = evidence(raw.corrections?.evidence ?? [], `${path}.corrections.evidence`);
    row.corrections = count;
    if (count !== null && row.evidence.corrections.length === 0) {
      row.corrections = null;
      row.warnings.push('corrections: missing evidence; treated as unknown');
    }
    // A first pass is itself a successful delivery; contradictory annotations are rejected.
    if (row.firstPass === 'pass' && row.final === 'fail') throw new Error(`${path}: firstPass pass conflicts with final fail`);
    row.recovered = row.final === 'pass' && row.firstPass === 'fail';
    row.needsReview = row.warnings.length > 0 || row.final === 'unknown' || row.firstPass === 'unknown' || row.corrections === null;
    return row;
  });
  const paired = tasks.filter(t => t.final !== 'unknown' && t.firstPass !== 'unknown');
  const knownCorrections = tasks.filter(t => t.corrections !== null);
  const summarize = rows => ({ tasks: rows.length, final: metric(rows, 'final'), firstPass: metric(rows, 'firstPass') });
  const groups = [...new Set(tasks.map(t => JSON.stringify([t.model, t.harness])))].map(key => {
    const [model, harness] = JSON.parse(key);
    return { model, harness, ...summarize(tasks.filter(t => t.model === model && t.harness === harness)) };
  });
  return {
    schemaVersion: 1, tool: 'task-lens', dataset: typeof input.label === 'string' ? input.label : 'Untitled task annotations',
    inputSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    summary: { ...summarize(tasks), paired: paired.length,
      pairedFinalRate: paired.length ? paired.filter(t => t.final === 'pass').length / paired.length : null,
      pairedFirstPassRate: paired.length ? paired.filter(t => t.firstPass === 'pass').length / paired.length : null,
      recovered: tasks.filter(t => t.recovered).length,
      corrections: { total: knownCorrections.reduce((n, t) => n + t.corrections, 0), known: knownCorrections.length,
        unknown: tasks.length - knownCorrections.length, mean: knownCorrections.length ? knownCorrections.reduce((n, t) => n + t.corrections, 0) / knownCorrections.length : null },
      needsReview: tasks.filter(t => t.needsReview).length },
    groups, tasks,
    limits: ['输入为人或 Agent 提交的标注。工具保留证据位置，但不会自动打开或核实引用内容。',
      '一个独立目标对应一个工作单元。普通确认不算纠正；未知值不计入通过率，同时显示标注覆盖情况。',
      '不同任务难度与样本数量会影响结果，分组指标不能用于证明某个模型更好。'],
  };
}
