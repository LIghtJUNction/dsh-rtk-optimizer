import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { compact } from './compact.js';
import { workspace } from './support.js';
import Schema from '@deepseek-ai/schemastery';

export const name = 'dsh-rtk-optimizer';
export const inject = ['tools'];
export interface Config { root?: string; executable?: string; toolNames?: string[]; auto?: boolean }
export const Config = Schema.object({ root: Schema.string(), executable: Schema.string(), toolNames: Schema.array(Schema.string()).default(['bash', 'shell']), auto: Schema.boolean().default(true) });

function rewrite(executable: string, command: string, cwd: string, signal: AbortSignal): Promise<{ command: string; rewritten: boolean; available: boolean; reason: string }> {
  signal.throwIfAborted();
  if (!command.trim() || Buffer.byteLength(command) > 64000) throw new Error('Expected a nonempty command of at most 64 KB');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, ['rewrite', command], { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let failure: Error | undefined; let oversized = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (stdout.length + chunk.length > 128000) { oversized = true; child.kill('SIGKILL'); } else stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', (error) => { failure = error; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal.aborted) { reject(signal.reason); return; }
      if (failure && 'code' in failure && failure.code === 'ENOENT') { resolvePromise({ command, rewritten: false, available: false, reason: 'rtk executable unavailable; original command retained' }); return; }
      if (failure) { reject(failure); return; }
      if (oversized) { reject(new Error('rtk rewrite output exceeded limit')); return; }
      const suggested = stdout.trim();
      if ((code === 0 || code === 3) && suggested) { resolvePromise({ command: suggested, rewritten: suggested !== command, available: true, reason: 'rtk rewrite suggestion; command has not been executed' }); return; }
      resolvePromise({ command, rewritten: false, available: true, reason: code === 1 ? 'No rewrite' : `Rewrite refused or failed (${code}): ${stderr}` });
    });
  });
}

export function apply(ctx: Context, config: Config = {}): void {
  const totals = { outputs: 0, originalBytes: 0, outputBytes: 0 };
  const names = new Set(config.toolNames ?? ['bash', 'shell']);
  if (config.auto !== false) ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    if (decision.kind !== 'accept' || 'value' in decision || result.isError || !names.has(exec.name) || exec.signal.aborted) return decision;
    const blocks = decision.content ?? result.content;
    const content = blocks.map(block => {
      if (block.type !== 'text') return block;
      const value = compact(block.text);
      if (value.changed) { totals.outputs++; totals.originalBytes += value.originalBytes; totals.outputBytes += value.outputBytes; }
      return value.changed ? { ...block, text: value.text } : block;
    });
    return { ...decision, content };
  });
  ctx.tools.register(defineTool({
    name: 'rtk_rewrite', description: 'Ask the installed local RTK CLI for a shell-command rewrite. Returns a suggestion only; never executes the proposed shell command. Missing RTK retains the original command.',
    parameters: { command: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { command: { type: 'string', required: true }, rewritten: { type: 'boolean', required: true }, available: { type: 'boolean', required: true }, reason: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) { const root = await realpath(workspace(ctx, exec, config.root)); return rewrite(config.executable ?? 'rtk', args.command, root, exec.signal); },
  }));
  ctx.tools.register(defineTool({
    name: 'rtk_compact', description: 'Compact supplied terminal/test output by stripping ANSI and aggregating passing-test and consecutive duplicate lines. Does not truncate. Do not use on source code or edit anchors.',
    parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true }, originalBytes: { type: 'integer', required: true }, outputBytes: { type: 'integer', required: true }, changed: { type: 'boolean', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.text }] },
    async execute(args, exec) { exec.signal.throwIfAborted(); if (Buffer.byteLength(args.text) > 1024 * 1024) throw new Error('Input exceeds 1 MiB'); return compact(args.text); },
  }));
  ctx.tools.register(defineTool({
    name: 'rtk_stats', description: 'Read aggregate plugin-lifetime byte savings from automatic shell output projections. Byte counts are not token or billing measurements.',
    parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { outputs: { type: 'integer', required: true }, originalBytes: { type: 'integer', required: true }, outputBytes: { type: 'integer', required: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(_args, exec) { exec.signal.throwIfAborted(); return { ...totals }; },
  }));
}
