import { esc, page } from './page.js';
const rate = metric => metric.rate === null ? '未知' : `${(metric.rate * 100).toFixed(1)}%`;
export function render(report) {
  const s = report.summary;
  const cards = [
    ['最终完成', rate(s.final), `${s.final.passed} / ${s.final.known} 已知；${s.final.unknown} 未知`],
    ['首次完成', rate(s.firstPass), `${s.firstPass.passed} / ${s.firstPass.known} 已知；${s.firstPass.unknown} 未知`],
    ['返工后完成', s.recovered, `双结果均已知的任务共 ${s.paired} 条`],
    ['人工纠正', s.corrections.total, `${s.corrections.known} 条已知；${s.corrections.unknown} 条未知`],
  ];
  const label = value => ({ pass: '通过', fail: '未通过', unknown: '未知' })[value];
  const fieldLabel = field => ({ final: '最终结果', firstPass: '首次交付', corrections: '人工纠正' })[field];
  const records = report.tasks.map(t => `<article data-record data-status="${[...(t.needsReview ? ['review'] : []), ...(t.recovered ? ['recovered'] : [])].join(' ') || 'other'}"><div class="record-head"><span class="eyebrow">${esc(t.project)} / ${esc(t.id)}</span><span class="tag">${t.needsReview ? '待补证据' : t.recovered ? '返工后完成' : '标注完整'}</span></div><h2>${esc(t.goal)}</h2><p>首次：<b>${label(t.firstPass)}</b>　最终：<b>${label(t.final)}</b>　纠正：<b>${t.corrections ?? '未知'}</b></p><p class="muted">${esc(t.model)} · ${esc(t.harness)}</p>${t.warnings.map(w => `<p class="warning">${fieldLabel(w.split(':')[0])}未提供证据，已按未知处理。</p>`).join('')}<details><summary>查看标注依据</summary>${Object.entries(t.evidence).map(([field, refs]) => `<h3>${fieldLabel(field)}</h3>${refs.length ? refs.map(ref => `<blockquote>${esc(ref.note)}<cite>${esc(ref.ref)}</cite></blockquote>`).join('') : '<p class="muted">没有提供依据</p>'}`).join('')}</details></article>`).join('');
  const paired = s.paired ? `同一批 ${s.paired} 条完整样本：最终 ${(s.pairedFinalRate * 100).toFixed(1)}%，首次 ${(s.pairedFirstPassRate * 100).toFixed(1)}%。` : '暂无双结果均已知的配对样本。';
  return page(report, { title: '再改一版', subtitle: '任务做完了，中间付出了什么？', cards,
    intro: `共 ${s.tasks} 个工作单元。未知值不进入通过率分母。${paired}分组只用于描述，不支持模型因果排名。`,
    filters: [['all', '全部任务'], ['recovered', '返工后完成'], ['review', '待补证据']], records,
    extra: `<section><h2>按模型与 Harness 观察</h2><div class="table-wrap"><table><thead><tr><th>模型</th><th>Harness</th><th>任务</th><th>最终完成</th><th>首次完成</th></tr></thead><tbody>${report.groups.map(g => `<tr><td>${esc(g.model)}</td><td>${esc(g.harness)}</td><td>${g.tasks}</td><td>${rate(g.final)} (${g.final.known} 已知)</td><td>${rate(g.firstPass)} (${g.firstPass.known} 已知)</td></tr>`).join('')}</tbody></table></div></section>` });
}
