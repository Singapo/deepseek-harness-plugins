import { esc, page } from './page.js';
const labels = { conflict: '存在分歧', needs_review: '引用待核查', unsupported: '缺少支持', single_origin: '单一来源链', multiple_origins: '多个来源链' };
const reasons = { source_missing: '找不到引用的来源。', quote_not_found: '引句没有出现在这份原文快照里。', origin_unspecified: '尚未标注原始发布者，不能计为独立来源。', no_valid_support: '尚无原文匹配的支持性证据。', support_not_independent_or_origin_unknown: '部分支持材料属于同一来源链，或原始发布者尚未确认。' };
const stances = { supports: '支持', contradicts: '反驳', context: '背景' };
export function render(report) {
  const s = report.summary;
  const cards = [['结论', s.claims, `${s.sources} 份来源快照`], ['来源链', s.originGroups, '依据声明的源头、URL 与正文分组'],
    ['存在分歧', s.statuses.conflict, '支持与反驳关系由提交者标注'], ['无效引用', s.invalidQuotes, '找不到来源或引句未出现在快照中']];
  const anchor = id => report.sources.findIndex(source => source.id === id);
  const records = report.claims.map(claim => `<article data-record data-status="${claim.status}"><div class="record-head"><span class="eyebrow">${esc(claim.id)}</span><span class="tag">${labels[claim.status]}</span></div><h2>${esc(claim.text)}</h2><p class="muted">支持：${claim.supportingSources} 份来源 / ${claim.supportingOrigins} 条已声明来源链；反驳：${claim.contradictingSources} 份来源</p>${claim.reasons.map(reason => `<p class="warning">${esc(reasons[reason])}</p>`).join('')}<details${['conflict', 'needs_review'].includes(claim.status) ? ' open' : ''}><summary>逐条核查引句</summary>${claim.evidence.length ? claim.evidence.map(e => `<blockquote>${esc(e.quote)}<cite>${stances[e.stance]} · ${anchor(e.sourceId) >= 0 ? `<a href="#source-${anchor(e.sourceId)}">${esc(e.sourceId)}</a>` : esc(e.sourceId)} · ${e.valid ? `原文匹配，字符位置 ${e.offset}` : esc(reasons[e.issue])}${e.originGroup ? ` · ${esc(e.originGroup)}` : ''}</cite></blockquote>`).join('') : '<p class="muted">没有提供证据。</p>'}</details></article>`).join('');
  const extra = `<section><h2>来源快照</h2><p class="muted">链接指向提交者提供的地址；本工具没有联网核对。指纹对应本次保存的正文 UTF-8 字节。</p>${report.sources.map((source, i) => `<details id="source-${i}"><summary>${esc(source.title)} · ${esc(source.originGroup)}</summary><p><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.url)}</a></p><p class="muted">来源标注：${esc(source.origin ?? '未提供')}<br>上游：${esc(source.upstream ?? '未提供')}<br>快照时间：${esc(source.capturedAt)}<br>SHA-256：${esc(source.sha256)}</p><pre>${esc(source.content)}</pre></details>`).join('')}</section>`;
  return page(report, { title: '较真 · 引用检查', subtitle: '这句话，原文里有吗？', cards,
    intro: '原文匹配只证明引句存在。多个来源链不等于结论为真；支持、反驳和来源标注仍需人审。',
    filters: [['all', '全部结论'], ...Object.entries(labels)], records, extra });
}
