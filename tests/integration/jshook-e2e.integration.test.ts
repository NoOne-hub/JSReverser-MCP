import {describe, it} from 'node:test';
import assert from 'node:assert';
import {SmartCodeCollector} from '../../src/modules/collector/SmartCodeCollector.js';
import {HookManager} from '../../src/modules/hook/HookManager.js';
import {GeminiProvider} from '../../src/services/GeminiProvider.js';
import {ToolExecutionScheduler} from '../../src/utils/ToolExecutionScheduler.js';

const runE2E = process.env.RUN_E2E_TESTS === 'true';

describe('E2E Scenarios', {skip: !runE2E}, () => {
  it('Scenario 1: code collection and analysis flow', async () => {
    const collector = new SmartCodeCollector();
    const files = [{url: 'https://x/app.js', content: 'const sign=md5(a);', size: 18, type: 'external'}] as any;
    const summaries = await collector.smartCollect({} as any, files, {mode: 'summary'} as any);
    assert.ok(Array.isArray(summaries));
  });

  it('Scenario 2: hook inject preparation flow', async () => {
    const manager = new HookManager();
    const hook = manager.create({type: 'fetch'} as any);
    assert.ok(hook.script.includes('fetch'));
  });

  it('Scenario 3: gemini CLI mode flow', async () => {
    const provider = new GeminiProvider({useAPI: false, cliPath: 'non-existent-gemini-cli-command'});
    await assert.rejects(async () => provider.chat([{role: 'user', content: 'test'}]), /gemini-cli is not available/);
  });

  it('Scenario 4: multi-tool concurrency flow', async () => {
    const scheduler = new ToolExecutionScheduler();
    const results = await Promise.all([
      scheduler.execute(true, async () => 'a'),
      scheduler.execute(true, async () => 'b'),
    ]);
    assert.deepStrictEqual(results.sort(), ['a', 'b']);
  });
});
