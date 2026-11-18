import { installProtection } from './src/protected.js';

export const name = 'jiaozhen-protected';
export const inject = ['tools', 'llm'];
export function apply(ctx, config = {}) { installProtection(ctx, config.requestPath); }
