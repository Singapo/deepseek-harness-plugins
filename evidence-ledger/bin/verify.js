#!/usr/bin/env node
import { mkdir, realpath, lstat, writeFile, rename, rm, open } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runVerification, within } from '../src/workflow.js';
import { renderVerification } from '../src/verify-report.js';

const args = process.argv.slice(2);
const blockedText = '# 尚未通过核验\n\n本次没有可交付的数据结论。请查看 report.html，修正后重新运行。\n';
if (args.length !== 3 || args[1] !== '--out') {
  console.error('Usage: node bin/verify.js <check.json> --out <report-directory>');
  process.exitCode = 1;
} else {
  let lock, lockPath;
  try {
    const candidate = resolve(args[0]);
    const request = await realpath(candidate).catch(error => { if (error.code === 'ENOENT') return candidate; throw error; });
    const requestRoot = dirname(request);
    const out = resolve(args[2]);
    // Output and input trees must be disjoint, including resolved symlinks.
    await mkdir(out, { recursive: true });
    const actualOut = await realpath(out);
    if (within(requestRoot, actualOut) || within(actualOut, requestRoot)) throw new Error('Output must be separate from the input directory');
    for (const file of ['report.json', 'report.html', 'verified.md']) {
      const stat = await lstat(join(actualOut, file)).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)) throw new Error('Output must be a regular, unlinked file');
    }
    lockPath = join(actualOut, '.jiaozhen.lock');
    lock = await open(lockPath, 'wx');
    // Close a previous delivery before reading new inputs; errors cannot leave a stale approved text.
    await writeFile(join(actualOut, 'verified.md'), blockedText);
    let report;
    try { report = await runVerification(request); }
    catch (error) {
      await writeFile(join(actualOut, 'report.json'), JSON.stringify({ gate: { status: 'blocked', verifiedText: null }, error: error.message }, null, 2) + '\n');
      const { esc } = await import('../src/page.js');
      await writeFile(join(actualOut, 'report.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>较真 · 未通过</title><h1>本次核验未完成，交付已关闭</h1><p>${esc(error.message)}</p></html>`);
      throw error;
    }
    await writeFile(join(actualOut, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(join(actualOut, 'report.html'), renderVerification(report));
    if (report.gate.status === 'passed') {
      const temporary = join(actualOut, `.verified-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, '# 数据核验结果\n\n' + report.gate.deliverableText + '\n\n口径：与本次取得的数据及核验规则一致。\n', { flag: 'wx' });
        await rename(temporary, join(actualOut, 'verified.md'));
      } finally { await rm(temporary, { force: true }); }
    }
    console.log(JSON.stringify({ output: actualOut, gate: report.gate.status, ...report.summary }, null, 2));
    process.exitCode = report.gate.status === 'passed' ? 0 : 2;
  } catch (error) { console.error(`jiaozhen: ${error.message}`); process.exitCode = 1; }
  finally { if (lock) { await lock.close(); await rm(lockPath, { force: true }); } }
}
