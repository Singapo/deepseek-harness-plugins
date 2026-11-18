import { defineTool } from '@deepseek-ai/dsh-tools';
import { audit } from './src/core.js';
import { runVerification } from './src/workflow.js';

export const name = 'evidence-ledger';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'jiaozhen_verify_data',
    description: 'Read an explicitly user-authorized check request. Local sources use confined files and pinned hashes; worldbank sources use a fixed official HTTPS population API and deterministic mapping. Verify exact entity/period/metric, units and numeric claims with deterministic arithmetic. No model calls. Return gate=blocked unless every check passes. Only gate.verifiedText is deliverable. Do not rewrite sources, invent values or replace blocked results with model guesses. This diagnostic tool alone does not protect host replies; use the protected plugin for enforced output.',
    parameters: { requestPath: { type: 'string', required: true, description: 'Absolute path to a user-authorized schemaVersion:2 check request. Source paths must remain under that file directory, including resolved links. Reads regular files <=2 MiB each, at most 20 sources. Never scan unrelated files.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    isConcurrencySafe: () => true,
    async execute({ requestPath }, exec) { exec.signal.throwIfAborted(); return runVerification(requestPath, { signal: exec.signal }); },
  }));
  ctx.tools.register(defineTool({
    name: 'evidence_ledger_audit',
    description: 'Audit claims against supplied local source snapshots: exact quote integrity, source lineage grouping, missing evidence and conflicting stance annotations. NOT a truth or entailment detector. Do not fabricate source content, timestamps, origins or stances. Read-only; no network or model calls.',
    parameters: { brief: { type: 'json', required: true, description: 'Object with schemaVersion:1, label, sources:[{id,title,url,origin?,upstream?,capturedAt:ISO-with-timezone,content}], claims:[{id,text,evidence:[{sourceId,quote,stance:supports|contradicts|context}]}]. Origin is original publisher, not reprint site; upstream links a reprint to original URL.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    isConcurrencySafe: () => true,
    async execute({ brief }, exec) { exec.signal.throwIfAborted(); return audit(brief); },
  }));
}
