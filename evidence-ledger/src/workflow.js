import { open, realpath } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, relative, sep } from 'node:path';
import { verifyData, sha256 } from './verify.js';
import { fetchAuthority } from './authority.js';

export const within = (root, target) => { const rel = relative(root, target); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
async function readBounded(path, signal) {
  signal?.throwIfAborted();
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Expected regular file <= 2 MiB');
    // Bounded read also handles a source growing after stat().
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** Read named source files only; resolve real paths before enforcing the request-directory boundary. */
export async function runVerification(requestPath, { signal, requireAuthority = false, fetchImpl, now } = {}) {
  signal?.throwIfAborted();
  const actualRequest = await realpath(resolve(requestPath));
  const root = dirname(actualRequest);
  const requestBytes = await readBounded(actualRequest, signal);
  const request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(requestBytes).replace(/^\uFEFF/, ''));
  if (request?.schemaVersion !== 2 || !Array.isArray(request.sources) || request.sources.length > 20) throw new Error('Expected schemaVersion:2 and at most 20 sources');
  const snapshots = [];
  const materialized = structuredClone(request);
  const provenance = [];
  for (const source of request.sources) {
    signal?.throwIfAborted();
    try {
      if (source?.provider || requireAuthority) {
        const snapshot = await fetchAuthority(source, { signal, fetchImpl, now });
        const index = snapshots.length;
        materialized.sources[index].sha256 = sha256(snapshot.bytes);
        snapshots.push(snapshot);
        provenance.push({ sourceId: source.id, ...snapshot.provenance });
        continue;
      }
      if (typeof source?.path !== 'string' || isAbsolute(source.path) || /^[a-z]:/i.test(source.path) || source.path.includes('\0')) throw new Error('Relative source path required');
      const candidate = resolve(root, source.path);
      if (!within(root, candidate)) throw new Error('Source path outside request directory');
      const actualSource = await realpath(candidate);
      if (!within(root, actualSource)) throw new Error('Source link outside request directory');
      snapshots.push({ bytes: await readBounded(actualSource, signal) });
    } catch (error) {
      signal?.throwIfAborted();
      snapshots.push({ error: error.message, issue: error.code });
    }
  }
  const report = verifyData(materialized, snapshots);
  report.inputSha256 = sha256(requestBytes);
  report.provenance = provenance;
  report.gate.mode = requireAuthority ? 'authority-required' : provenance.length ? 'authority' : 'local-snapshot';
  report.gate.deliverableText = report.gate.verifiedText === null ? null : report.gate.verifiedText
    + (provenance.length ? '\n\n来源：' + provenance.map(p => `${p.url}（发布更新 ${p.lastUpdated}；取数 ${p.retrievedAt}；原始响应 SHA-256 ${p.rawSha256}）`).join('\n') : '');
  report.gate.outputSha256 = report.gate.deliverableText === null ? null : sha256(report.gate.deliverableText);
  if (provenance.length) {
    report.limits[0] = '官方来源表示由代码从固定 HTTPS 接口取得并按明确规则抽取；不表示发布方数据永不修订或毫无误差。';
    report.limits[1] = '官方接口的国家、指标、期间、整数值、分页与发布时间均经过规则检查；当前官方适配器仅支持世界银行 WDI 人口发布值。';
  }
  return report;
}
