import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cliOptions, parseArguments } from '../../../src/cli.js';

describe('cli extended coverage', () => {
  it('validates browserUrl/wsEndpoint/wsHeaders coercion', () => {
    const browserUrl = (cliOptions as any).browserUrl.coerce;
    assert.strictEqual(browserUrl(undefined), undefined);
    assert.strictEqual(browserUrl('http://127.0.0.1:9222'), 'http://127.0.0.1:9222');
    assert.throws(() => browserUrl('not-a-url'), /not valid URL/);

    const wsEndpoint = (cliOptions as any).wsEndpoint.coerce;
    assert.strictEqual(wsEndpoint(undefined), undefined);
    assert.strictEqual(
      wsEndpoint('ws://127.0.0.1:9222/devtools/browser/abc'),
      'ws://127.0.0.1:9222/devtools/browser/abc',
    );
    assert.throws(
      () => wsEndpoint('http://127.0.0.1:9222/devtools/browser/abc'),
      /must use ws:\/\/ or wss:\/\//,
    );
    assert.throws(() => wsEndpoint('::bad::'), /not valid URL/);

    const wsHeaders = (cliOptions as any).wsHeaders.coerce;
    assert.strictEqual(wsHeaders(undefined), undefined);
    assert.deepStrictEqual(wsHeaders('{"Authorization":"Bearer x"}'), {
      Authorization: 'Bearer x',
    });
    assert.throws(() => wsHeaders('[1,2]'), /Invalid JSON for wsHeaders/);
    assert.throws(() => wsHeaders('{bad json}'), /Invalid JSON for wsHeaders/);
  });

  it('validates viewport coercion', () => {
    const viewport = (cliOptions as any).viewport.coerce;
    assert.strictEqual(viewport(undefined), undefined);
    assert.deepStrictEqual(viewport('1280x720'), { width: 1280, height: 720 });
    assert.throws(() => viewport('bad-size'), /Invalid viewport/);
    assert.throws(() => viewport('0x720'), /Invalid viewport/);
  });

  it('parseArguments applies stable channel default when launch target is absent', () => {
    const args = parseArguments('1.2.3', ['node', 'cli.js']);
    assert.strictEqual((args as any).channel, 'stable');
    assert.strictEqual((args as any).headless, false);
    assert.strictEqual((args as any).isolated, false);
    assert.strictEqual((args as any).categoryNetwork, true);
  });

  it('parseArguments keeps explicit launch target without forcing channel', () => {
    const byUrl = parseArguments('1.2.3', [
      'node',
      'cli.js',
      '--browserUrl',
      'http://127.0.0.1:9222',
    ]);
    assert.strictEqual((byUrl as any).browserUrl, 'http://127.0.0.1:9222');
    assert.strictEqual((byUrl as any).channel, undefined);

    const byWs = parseArguments('1.2.3', [
      'node',
      'cli.js',
      '--wsEndpoint',
      'ws://127.0.0.1:9222/devtools/browser/abc',
      '--wsHeaders',
      '{"Authorization":"Bearer token"}',
    ]);
    assert.strictEqual(
      (byWs as any).wsEndpoint,
      'ws://127.0.0.1:9222/devtools/browser/abc',
    );
    assert.deepStrictEqual((byWs as any).wsHeaders, { Authorization: 'Bearer token' });
    assert.strictEqual((byWs as any).channel, undefined);
  });

  it('parseArguments supports chrome args, viewport and hidden toggles', () => {
    const parsed = parseArguments('9.9.9', [
      'node',
      'cli.js',
      '--channel',
      'beta',
      '--headless',
      '--isolated',
      '--viewport',
      '1440x900',
      '--chrome-arg=--no-sandbox',
      '--chrome-arg=--disable-gpu',
      '--no-category-network',
      '--experimentalDevtools',
      '--experimentalIncludeAllPages',
    ]);

    assert.strictEqual((parsed as any).channel, 'beta');
    assert.strictEqual((parsed as any).headless, true);
    assert.strictEqual((parsed as any).isolated, true);
    assert.deepStrictEqual((parsed as any).viewport, { width: 1440, height: 900 });
    assert.deepStrictEqual((parsed as any).chromeArg, ['--no-sandbox', '--disable-gpu']);
    assert.strictEqual((parsed as any).categoryNetwork, false);
    assert.strictEqual((parsed as any).experimentalDevtools, true);
    assert.strictEqual((parsed as any).experimentalIncludeAllPages, true);
  });
});
