import { defineTool } from '@deepseek-ai/dsh-tools';
import { analyze } from './src/core.js';

export const name = 'task-lens';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'task_lens_analyze',
    description: 'Analyze explicit agent task annotations: first-pass vs final outcome, human corrections, recovery and unknown coverage. Submit one independently assessable goal per task with evidence refs; never infer user corrections from sentiment. Input follows the bundled examples/tasks.json. Read-only; no model or network calls.',
    parameters: { dataset: { type: 'json', required: true, description: 'Object with schemaVersion:1, label, tasks[]. Each task has id, goal, project; final/firstPass:{value:pass|fail|unknown,evidence:[{ref,note}]}; corrections:{value:integer|null,evidence:[{ref,note}]}; optional model,harness.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    isConcurrencySafe: () => true,
    async execute({ dataset }, exec) { exec.signal.throwIfAborted(); return analyze(dataset); },
  }));
}
