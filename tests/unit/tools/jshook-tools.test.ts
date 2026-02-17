import {describe, it} from 'node:test';
import assert from 'node:assert';
import {zod} from '../../../src/third_party/index.js';
import {collectCode, collectionDiff} from '../../../src/tools/jshook/collector.js';
import {analyzeTarget, riskPanel, summarizeCode, exportSessionReport} from '../../../src/tools/jshook/analyzer.js';
import {createHook} from '../../../src/tools/jshook/hook.js';
import {injectStealth} from '../../../src/tools/jshook/stealth.js';
import {queryDom} from '../../../src/tools/jshook/dom.js';
import {navigatePage} from '../../../src/tools/jshook/page.js';

describe('jshook tools schema', () => {
  it('validates collect_code schema', () => {
    const schema = zod.object(collectCode.schema);
    const result = schema.parse({
      url: 'https://example.com',
      smartMode: 'summary',
      returnMode: 'pattern',
      pattern: 'main',
      limit: 5,
      topN: 3,
    });
    assert.strictEqual(result.smartMode, 'summary');
    assert.strictEqual(result.returnMode, 'pattern');
  });

  it('validates collection_diff schema', () => {
    const schema = zod.object(collectionDiff.schema);
    const result = schema.parse({
      previous: [{url: 'a.js', size: 12, type: 'external'}],
      includeUnchanged: true,
    });
    assert.strictEqual(result.previous.length, 1);
    assert.strictEqual(result.includeUnchanged, true);
  });

  it('validates summarize_code schema', () => {
    const schema = zod.object(summarizeCode.schema);
    const result = schema.parse({mode: 'single', code: 'const x = 1;'});
    assert.strictEqual(result.mode, 'single');
  });

  it('validates risk_panel and export_session_report schemas', () => {
    const riskSchema = zod.object(riskPanel.schema);
    const analyzeSchema = zod.object(analyzeTarget.schema);
    const reportSchema = zod.object(exportSessionReport.schema);

    const risk = riskSchema.parse({code: 'md5(x)', includeHookSignals: true});
    const workflow = analyzeSchema.parse({
      url: 'https://example.com',
      hookPreset: 'network-core',
      autoInjectHooks: true,
      correlationWindowMs: 800,
      maxCorrelatedFlows: 5,
      maxFingerprints: 6,
    });
    const report = reportSchema.parse({format: 'markdown', includeHookData: true});

    assert.strictEqual(risk.includeHookSignals, true);
    assert.strictEqual(workflow.hookPreset, 'network-core');
    assert.strictEqual(workflow.maxFingerprints, 6);
    assert.strictEqual(report.format, 'markdown');
  });

  it('validates hook and stealth schemas', () => {
    const hookSchema = zod.object(createHook.schema);
    const stealthSchema = zod.object(injectStealth.schema);

    const hook = hookSchema.parse({type: 'fetch'});
    const stealth = stealthSchema.parse({preset: 'windows-chrome'});

    assert.strictEqual(hook.type, 'fetch');
    assert.strictEqual(stealth.preset, 'windows-chrome');
  });

  it('validates dom and page schemas', () => {
    const domSchema = zod.object(queryDom.schema);
    const pageSchema = zod.object(navigatePage.schema);

    const dom = domSchema.parse({selector: 'button'});
    const page = pageSchema.parse({url: 'https://example.com'});

    assert.strictEqual(dom.selector, 'button');
    assert.strictEqual(page.url, 'https://example.com');
  });
});
