import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Development only: use a caller-selected installed SDK, without copying it or touching profiles.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/') && process.env.DSH_MODULE_ROOT) {
    const require = createRequire(join(process.env.DSH_MODULE_ROOT, 'package.json'));
    return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
