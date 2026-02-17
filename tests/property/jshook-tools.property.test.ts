import {describe, it} from 'node:test';
import fc from 'fast-check';
import assert from 'node:assert';
import {zod} from '../../src/third_party/index.js';
import {collectCode} from '../../src/tools/jshook/collector.js';
import {summarizeCode} from '../../src/tools/jshook/analyzer.js';
import {createHook} from '../../src/tools/jshook/hook.js';
import {injectStealth} from '../../src/tools/jshook/stealth.js';
import {queryDom} from '../../src/tools/jshook/dom.js';
import {navigatePage} from '../../src/tools/jshook/page.js';

const collectSchema = zod.object(collectCode.schema);
const summarizeSchema = zod.object(summarizeCode.schema);
const hookSchema = zod.object(createHook.schema);
const stealthSchema = zod.object(injectStealth.schema);
const domSchema = zod.object(queryDom.schema);
const pageSchema = zod.object(navigatePage.schema);

describe('JSHook tool properties', () => {
  it('Property 4: collection mode support', () => {
    fc.assert(
      fc.property(fc.constantFrom('summary', 'priority', 'incremental', 'full'), mode => {
        const parsed = collectSchema.parse({url: 'https://example.com', smartMode: mode});
        assert.strictEqual(parsed.smartMode, mode);
      }),
    );
  });

  it('Property 7: collection result input structure guards', () => {
    const parsed = collectSchema.parse({url: 'https://example.com', maxTotalSize: 1000, maxFileSize: 100});
    assert.ok(parsed.url.startsWith('https://'));
  });

  it('Property 10: summarization mode support', () => {
    fc.assert(
      fc.property(fc.constantFrom('single', 'batch', 'project'), mode => {
        const parsed = summarizeSchema.parse({mode});
        assert.strictEqual(parsed.mode, mode);
      }),
    );
  });

  it('Property 12: hook type support', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('function', 'fetch', 'xhr', 'property', 'cookie', 'websocket', 'eval', 'timer'),
        type => {
          const parsed = hookSchema.parse({type});
          assert.strictEqual(parsed.type, type);
        },
      ),
    );
  });

  it('Property 15: stealth preset support', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('windows-chrome', 'mac-chrome', 'mac-safari', 'linux-chrome', 'windows-edge'),
        preset => {
          const parsed = stealthSchema.parse({preset});
          assert.strictEqual(parsed.preset, preset);
        },
      ),
    );
  });

  it('Property 17: dom query support', () => {
    fc.assert(
      fc.property(fc.string({minLength: 1, maxLength: 20}), selector => {
        const parsed = domSchema.parse({selector});
        assert.strictEqual(parsed.selector, selector);
      }),
    );
  });

  it('Property 19: page control operations', () => {
    const parsed = pageSchema.parse({url: 'https://example.com'});
    assert.strictEqual(parsed.url, 'https://example.com');
  });
});
