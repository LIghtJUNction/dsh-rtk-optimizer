import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';
import * as plugin from '../src/index.js';
import { createHost } from './host.js';

function value(result: Awaited<ReturnType<Awaited<ReturnType<typeof createHost>>['execute']>>) {
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.ok('value' in result && result.value !== null && typeof result.value === 'object' && !Array.isArray(result.value));
  return result.value;
}
const log = '\x1b[32m' + Array.from({ length: 80 }, (_, i) => `ok ${i + 1} - a passing test with descriptive name`).join('\n') + '\x1b[0m\nFAIL important failure\nError: exact diagnostic';

test('real runtime validates schema and compacts terminal output while retaining failure diagnostics', async t => {
  const host = await createHost(); t.after(() => host.close());
  await host.ctx.plugin(plugin, { auto: false });
  const result = value(await host.execute('rtk_compact', { text: log }));
  assert.equal(result.changed, true);
  assert.ok(typeof result.text === 'string' && result.text.includes('FAIL important failure') && result.text.includes('Error: exact diagnostic'));
  assert.ok(typeof result.outputBytes === 'number' && typeof result.originalBytes === 'number' && result.outputBytes < result.originalBytes);
  assert.equal((await host.execute('rtk_compact', { text: 5 })).isError, true);
  assert.equal(value(await host.execute('rtk_compact', { text: 'source\n  keep whitespace\n' })).changed, false);
});

test('automatic post-policy projection preserves canonical value and excludes hashline tools', async t => {
  const host = await createHost(); t.after(() => host.close());
  await host.ctx.plugin(plugin, {});
  for (const name of ['bash', 'hashline_read']) host.ctx.tools.register(defineTool({
    name, description: 'fixture', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute() { return log; },
  }));
  const shell = await host.execute('bash', {});
  assert.equal(shell.isError, false);
  assert.ok('value' in shell && shell.value === log);
  assert.ok(JSON.stringify(shell.content).length < JSON.stringify(log).length);
  const read = await host.execute('hashline_read', {});
  assert.deepEqual(read.content, [{ type: 'text', text: log }]);
  assert.equal(value(await host.execute('rtk_stats', {})).outputs, 1);
  host.ctx.on('tools/post-execute', async (_exec, _result, _next) => ({ kind: 'block', feedback: [{ type: 'text', text: 'policy refused' }] }));
  assert.equal((await host.execute('bash', {})).isError, true);
});

test('rewrite missing binary degrades and executable receives one literal command argument without executing it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rtk-test-'));
  const host = await createHost(root);
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  await host.ctx.plugin(plugin, { root, executable: '/nonexistent/dsh-rtk' });
  const absent = value(await host.execute('rtk_rewrite', { command: 'git status' }));
  assert.equal(absent.available, false); assert.equal(absent.command, 'git status');
  const other = await createHost(root); t.after(() => other.close());
  const fake = join(root, 'rtk-fixture');
  await writeFile(fake, '#!/usr/bin/env node\nrequire("fs").writeFileSync("args.json", JSON.stringify(process.argv.slice(2))); process.stdout.write("rtk git status"); process.exitCode=3;\n', { mode: 0o700 });
  await other.ctx.plugin(plugin, { root, executable: fake });
  const command = 'git status; touch must-not-exist';
  const rewritten = value(await other.execute('rtk_rewrite', { command }));
  assert.equal(rewritten.rewritten, true);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'args.json'), 'utf8')), ['rewrite', command]);
  await assert.rejects(readFile(join(root, 'must-not-exist')));
  const controller = new AbortController(); controller.abort();
  assert.equal((await other.execute('rtk_rewrite', { command }, controller.signal)).isError, true);
});
