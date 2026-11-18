#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { audit } from '../src/core.js';
import { render } from '../src/report.js';

const args = process.argv.slice(2);
if (args.length !== 3 || args[1] !== '--out') {
  console.error('Usage: node bin/cli.js <brief.json> --out <report-directory>');
  process.exitCode = 1;
} else {
  try {
    const inputPath = resolve(args[0]);
    const out = resolve(args[2]);
    if ([join(out, 'report.json'), join(out, 'report.html')].some(p => p.toLowerCase() === inputPath.toLowerCase())) throw new Error('Output would overwrite input');
    const data = await readFile(inputPath, 'utf8');
    if (Buffer.byteLength(data) > 20 * 1024 * 1024) throw new Error('Input exceeds 20 MiB');
    const report = audit(JSON.parse(data.replace(/^\uFEFF/, '')));
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(join(out, 'report.html'), render(report));
    console.log(JSON.stringify({ output: out, ...report.summary }, null, 2));
  } catch (error) { console.error(`evidence-ledger: ${error.message}`); process.exitCode = 1; }
}
