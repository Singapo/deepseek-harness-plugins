import { resolve, isAbsolute } from 'node:path';
import { runVerification } from './workflow.js';

export function installProtection(ctx, requestPath) {
  if (!ctx.llm) throw new Error('Protected mode needs the llm service');
  // Invalid configuration still installs the blocker; never fail open into ordinary model output.
  const request = typeof requestPath === 'string' && isAbsolute(requestPath) ? resolve(requestPath) : null;
  // A dedicated data profile cannot use other tools to rewrite its own input or publish a separate file.
  ctx.tools.guard(() => '较真严格模式：宿主直接核验固定请求，禁止其他工具改写数据或绕过交付。');
  ctx.on('llm/stream', async function* (options) {
    options.signal?.throwIfAborted();
    if (options.purpose) {
      yield { type: 'text-delta', index: 0, text: '较真数据核验' };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    let text;
    try {
      if (!request) throw new Error('Absolute request path required');
      const report = await runVerification(request, { signal: options.signal, requireAuthority: true });
      text = report.gate.status === 'passed'
        ? report.gate.deliverableText
        : '较真已停止交付：' + [...report.issues.map(i => i.message), ...report.claims.flatMap(c => c.reasons.map(r => r.message))].join('；');
    } catch (error) {
      options.signal?.throwIfAborted();
      text = '较真已停止交付：核验请求或官方数据未通过检查。';
    }
    options.signal?.throwIfAborted();
    // Deliberately never call next(): no unverified model tokens, reasoning or tool calls can stream out.
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
}
