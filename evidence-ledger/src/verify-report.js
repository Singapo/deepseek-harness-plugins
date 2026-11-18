import { esc, page } from './page.js';
const labels = { verified: '核验通过', blocked: '已拦截', needs_review: '待核验' };
export function renderVerification(report) {
  const s = report.summary;
  const cards = [['交付闸门', report.gate.status === 'passed' ? '已放行' : '已关闭', '全部通过才生成交付正文'],
    ['核验通过', s.verified, `${s.claims} 条拟交付数据`], ['已拦截', s.blocked, '数值或口径不一致'],
    ['待核验', s.needsReview + s.sourceIssues, '缺失、不支持或来源有问题']];
  const records = report.claims.map(c => `<article data-record data-status="${esc(c.status)}"><div class="record-head"><span class="eyebrow">${esc(c.id)}</span><span class="tag">${labels[c.status]}</span></div><h2>${esc(c.entity)} · ${esc(c.period)} · ${esc(c.metric)}</h2><p>拟交付：<b>${esc(c.reportedValue ?? '未提供')} ${esc(c.unit)}</b>　重算：<b>${esc(c.expectedValue ?? '尚不能计算')}${c.expectedValue === null ? '' : ' ' + esc(c.unit)}</b></p>${c.reasons.map(r => `<p class="warning">${esc(r.message)}</p>`).join('')}<p class="muted">${esc(c.formula ?? '先补齐可核验的计算输入。')} · 小数位：${esc(c.decimals ?? '未指定')}</p><details${c.status === 'verified' ? '' : ' open'}><summary>查看原始行与计算依据</summary>${c.evidence.length ? c.evidence.map(e => `<blockquote>${esc(e.entity)} / ${esc(e.period)} / ${esc(e.metric)}：${esc(e.value)} ${esc(e.unit)}<cite>${esc(e.sourceId)} · 第 ${e.row} 条记录 · ${esc(e.basis)}<br>原文件 SHA-256：${esc(e.sourceSha256)}</cite></blockquote>`).join('') : '<p class="muted">没有取得满足当前口径的原始行。</p>'}</details></article>`).join('');
  const provenance = report.provenance ?? [];
  const extra = `<section><h2>${report.gate.status === 'passed' ? '可交付正文' : '这次先别交'}</h2><p>${esc(report.gate.rule)}</p><pre id="verified-text">${esc(report.gate.verifiedText ?? '还有数据没核清，本次不生成交付结论。请修正问题后重新核验。')}</pre></section>${provenance.length ? `<section><h2>官方取数记录</h2>${provenance.map(p => `<details open><summary>${esc(p.sourceId)} · 世界银行 WDI</summary><p class="muted">接口：${esc(p.url)}<br>发布更新：${esc(p.lastUpdated)}<br>取数时间：${esc(p.retrievedAt)}<br>原始响应 SHA-256：${esc(p.rawSha256)}<br>规范化数据 SHA-256：${esc(p.normalizedSha256)}</p><pre>${esc(JSON.stringify(p.rawRows, null, 2))}</pre></details>`).join('')}</section>` : ''}<section><h2>数据快照检查</h2>${report.issues.map(i => `<p class="warning">${esc(i.sourceId ?? '本次核验')}：${esc(i.message)}</p>`).join('')}${report.sources.map(s => `<details><summary>${esc(s.title)} · ${s.status === 'verified' ? '指纹一致' : '未通过'}</summary><p class="muted">文件：${esc(s.path ?? '官方接口规范化快照')}<br>基准指纹：${esc(s.expectedSha256 ?? '未提供')}<br>实际指纹：${esc(s.actualSha256 ?? '未取得')}<br>已载入：${s.rows} 行</p></details>`).join('')}</section>`;
  return page(report, { title: '较真', subtitle: '数据没核清，先别交。', cards,
    intro: '读取官方接口或固定原表，逐条核对口径、重算数字；数据缺失或结论有误，交付闸门就保持关闭。每次结果保留来源、时间和数据指纹。',
    filters: [['all', '全部数据'], ...Object.entries(labels)], records, extra });
}
