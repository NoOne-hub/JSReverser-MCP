import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SmartCodeCollector } from '../../../src/modules/collector/SmartCodeCollector.js';

describe('SmartCodeCollector extended', () => {
  const files = [
    {
      url: 'https://site.com/main-crypto.js',
      content: 'function enc(){return CryptoJS.AES.encrypt("a","b")} import x from "dep";',
      size: 200,
      type: 'external',
      metadata: {},
    },
    {
      url: 'https://site.com/vendor-lib.js',
      content: 'eval("1"); const req = require("axios")',
      size: 600_000,
      type: 'external',
      metadata: {},
    },
    {
      url: 'https://site.com/inline-api',
      content: 'const f = () => fetch("/api");',
      size: 100,
      type: 'inline',
      metadata: {},
    },
  ] as any[];

  it('routes by mode and returns summary details', async () => {
    const collector = new SmartCodeCollector();
    const summary = await collector.smartCollect(null as any, files as any, { mode: 'summary' } as any);
    assert.strictEqual(Array.isArray(summary), true);
    assert.strictEqual((summary[0] as any).hasEncryption, true);
    assert.strictEqual((summary[0] as any).imports.includes('dep'), true);

    const full = await collector.smartCollect(null as any, files as any, { mode: 'full', maxTotalSize: 10_000 } as any);
    assert.strictEqual(full.length >= 1, true);
  });

  it('collects by priority and applies truncation/size limits', () => {
    const collector = new SmartCodeCollector();
    const picked = (collector as any).collectByPriority(files as any, {
      mode: 'priority',
      maxTotalSize: 250,
      maxFileSize: 120,
      priorities: ['main', 'crypto'],
    } as any);

    assert.strictEqual(picked.length >= 1, true);
    assert.strictEqual((picked[0] as any).metadata?.priorityScore !== undefined, true);
    assert.strictEqual((picked[0] as any).size <= 120, true);
  });

  it('supports incremental filtering, default include-all and regex patterns', () => {
    const collector = new SmartCodeCollector();

    const incremental = (collector as any).collectIncremental(files as any, {
      mode: 'incremental',
      includePatterns: ['main|inline'],
      excludePatterns: ['vendor'],
      maxTotalSize: 10_000,
      maxFileSize: 1_000,
    } as any);
    assert.strictEqual(incremental.length, 2);

    const includeAll = (collector as any).collectIncremental(files as any, {
      mode: 'incremental',
      includePatterns: [],
      excludePatterns: [],
      maxTotalSize: 10_000,
      maxFileSize: 1_000,
    } as any);
    assert.strictEqual(includeAll.length >= 2, true);
  });

  it('covers detection and extraction helper branches', () => {
    const collector = new SmartCodeCollector() as any;

    assert.strictEqual(collector.detectEncryption('const x = md5("a")'), true);
    assert.strictEqual(collector.detectEncryption('const x = 1'), false);
    assert.strictEqual(collector.detectAPI('axios.get("/a")'), true);
    assert.strictEqual(collector.detectAPI('const x = 1'), false);
    assert.strictEqual(collector.detectObfuscation('\\x61\\x62\\x63'), true);
    assert.strictEqual(collector.detectObfuscation('line1\nline2'), false);

    const fnNames = collector.extractFunctions(
      'function run(){} const h=function(){}; obj={call:function(){}}; function run(){}',
    );
    assert.strictEqual(fnNames.includes('run'), true);
    assert.strictEqual(fnNames.includes('h'), true);

    const imports = collector.extractImports(
      'import x from "a"; const y=require("b"); import z from "a";',
    );
    assert.deepStrictEqual(imports.sort(), ['a', 'b']);
  });
});
