import { sha256 } from './verify.js';

const limit = 2 * 1024 * 1024;
export const worldBankMetric = '人口总数（世界银行发布值）';
function reject(code) { throw Object.assign(new Error(code), { code }); }
function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) reject('authority_invalid');
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) reject('authority_invalid');
  return time;
}
async function bodyBytes(response) {
  if (!response.body) reject('authority_invalid');
  const reader = response.body.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) reject('authority_invalid');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}

/** Fixed official endpoint and mapping; source URL, freshness and extraction rules are not model inputs. */
export async function fetchAuthority(source, { signal, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (source.provider !== 'worldbank') reject('authority_required');
  if (typeof source.country !== 'string' || !/^[A-Z]{3}$/.test(source.country)
    || !Number.isInteger(source.from) || !Number.isInteger(source.to) || source.from < 1900
    || source.to < source.from || source.to - source.from > 4 || source.to > new Date(now).getUTCFullYear()) reject('authority_invalid');
  signal?.throwIfAborted();
  const url = `https://api.worldbank.org/v2/country/${source.country}/indicator/SP.POP.TOTL?format=json&per_page=100`;
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  let response, raw;
  try {
    response = await fetchImpl(url, { redirect: 'error', signal: combined, headers: { Accept: 'application/json', 'User-Agent': 'jiaozhen-portfolio/0.3' } });
    if (!response.ok || response.redirected || response.url !== url || !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) reject('authority_invalid');
    raw = await bodyBytes(response);
    combined.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code === 'authority_invalid') throw error;
    reject('authority_unavailable');
  }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { reject('authority_invalid'); }
  if (!Array.isArray(data) || data.length !== 2) reject('authority_invalid');
  const [meta, records] = data;
  if (meta?.page !== 1 || meta.pages !== 1 || String(meta.sourceid) !== '2' || !Array.isArray(records)
    || records.length > 100 || Number(meta.total) !== records.length) reject('authority_invalid');
  const released = isoDate(meta.lastupdated);
  if (released > now + 86400000 || now - released > 365 * 86400000) reject('authority_stale');
  const years = new Map();
  for (const row of records) {
    if (row?.countryiso3code !== source.country || row.indicator?.id !== 'SP.POP.TOTL'
      || typeof row.date !== 'string' || !/^\d{4}$/.test(row.date)) reject('authority_invalid');
    const year = Number(row.date);
    if (year < source.from || year > source.to) continue;
    if (years.has(year) || !Number.isSafeInteger(row.value) || row.value < 0 || row.unit !== ''
      || row.decimal !== 0 || row.obs_status !== '') reject('authority_invalid');
    years.set(year, { entity: source.country, period: row.date, metric: worldBankMetric, unit: '人', value: String(row.value), basis: 'reported' });
  }
  if (years.size !== source.to - source.from + 1) reject('authority_incomplete');
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, rows: [...years].sort(([a], [b]) => a - b).map(([, row]) => row) }));
  return { bytes, provenance: { provider: 'worldbank', url, indicator: 'SP.POP.TOTL', country: source.country,
    retrievedAt: new Date(now).toISOString(), lastUpdated: meta.lastupdated, rawSha256: sha256(raw), rawResponseUtf8: raw.toString('utf8'), normalizedSha256: sha256(bytes),
    mapping: 'countryiso3code → entity; date → period; value → value; fixed SP.POP.TOTL → published-population metric',
    rawRows: records.filter(r => Number(r.date) >= source.from && Number(r.date) <= source.to) } };
}
