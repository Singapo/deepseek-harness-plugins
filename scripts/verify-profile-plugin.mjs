// Disposable assertion plugin for an isolated official-CLI profile, never install in a user profile.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
export const name = 'portfolio-install-verifier';
export const inject = ['tools'];
export async function apply(ctx) {
  try {
    const dataset = JSON.parse(await readFile(new URL('../task-lens/examples/tasks.json', import.meta.url), 'utf8'));
    const brief = JSON.parse(await readFile(new URL('../evidence-ledger/examples/brief.json', import.meta.url), 'utf8'));
    let task, ledger;
    for (let attempt = 0; attempt < 100; attempt++) {
      const invoke = (name, args) => ctx.tools.execute({ callId: `installed-${name}-${attempt}`, name, arguments: args, signal: AbortSignal.timeout(1000) });
      task = await invoke('task_lens_analyze', { dataset });
      ledger = await invoke('evidence_ledger_audit', { brief });
      if (!task.isError && !ledger.isError) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(task.isError, false, JSON.stringify(task));
    assert.equal(ledger.isError, false, JSON.stringify(ledger));
    assert.equal(task.value.summary.recovered, 1);
    assert.equal(ledger.value.summary.invalidQuotes, 1);
    const record = { method: 'Official dsh CLI profile boot and installed bundle dispatch; no custom resolver', sdk: '0.2.1-rc.2', taskLens: true, evidenceLedger: true, paidModelCalls: 0 };
    await writeFile(new URL('../artifacts/installation-validation.json', import.meta.url), JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify(record));
    process.exit(0);
  } catch (error) { console.error(error); process.exit(1); }
}
