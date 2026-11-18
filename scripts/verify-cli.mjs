import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = resolve(root, '.tmp/cli-check');
await mkdir(temp, { recursive: true });
const results = [];
try {
  for (const [project, fixture] of [['task-lens', 'tasks.json'], ['evidence-ledger', 'brief.json']]) {
    const cwd = resolve(root, project);
    const run = args => spawnSync(process.execPath, ['bin/cli.js', ...args], { cwd, encoding: 'utf8' });
    const ok = run([`examples/${fixture}`, '--out', resolve(temp, project)]);
    assert.equal(ok.status, 0, ok.stderr);
    const input = resolve(temp, `${project}-bad.json`);
    await writeFile(input, '{invalid');
    const invalid = run([input, '--out', resolve(temp, 'must-not-exist')]);
    assert.equal(invalid.status, 1);
    assert.ok(invalid.stderr.includes(project));
    const self = resolve(temp, project, 'report.json');
    const before = await readFile(self, 'utf8');
    assert.equal(run([self, '--out', resolve(temp, project)]).status, 1);
    assert.equal(await readFile(self, 'utf8'), before);
    results.push({ project, success: true, invalidJsonRejected: true, inputOverwriteRejected: true });
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
