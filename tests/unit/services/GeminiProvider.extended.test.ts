import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GeminiProvider } from '../../../src/services/GeminiProvider.js';

function makeCliScript(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe('GeminiProvider extended', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it('covers CLI chat success and helper methods', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-ok-'));
    tempDirs.push(dir);
    const cli = makeCliScript(
      dir,
      'gemini-ok.sh',
      `
if [ "$1" = "--version" ]; then
  echo "1.0.0"
  exit 0
fi
echo "  OK_RESPONSE  "
exit 0
`
    );

    const provider = new GeminiProvider({ cliPath: cli, useAPI: false }) as any;
    provider.cliAvailable = true;
    const chat = await provider.chat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
      { model: 'gemini-test', temperature: 0.2, maxTokens: 123 }
    );

    assert.strictEqual(chat.content, 'OK_RESPONSE');
    assert.strictEqual(chat.usage, undefined);
    assert.ok(provider.formatMessagesForCLI([{ role: 'user', content: 'x' }]).includes('User: x'));
    assert.strictEqual(provider.parseCliOutput('  hi\n'), 'hi');
    assert.strictEqual(provider.handleError('x').message.includes('Unknown error'), true);
  });

  it('covers analyzeImage CLI success and file-not-found error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-img-'));
    tempDirs.push(dir);
    const cli = makeCliScript(
      dir,
      'gemini-img.sh',
      `
if [ "$1" = "--version" ]; then
  exit 0
fi
echo "IMAGE_OK"
exit 0
`
    );
    const img = join(dir, 'a.png');
    writeFileSync(img, 'x');

    const provider = new GeminiProvider({ cliPath: cli, useAPI: false });
    (provider as any).cliAvailable = true;
    const ok = await provider.analyzeImage(img, 'describe', true);
    assert.strictEqual(ok, 'IMAGE_OK');

    await assert.rejects(
      async () => provider.analyzeImage(join(dir, 'missing.png'), 'describe', true),
      /Image file not found/
    );
  });

  it('covers executeCLI non-zero exit and cached CLI availability branch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-fail-'));
    tempDirs.push(dir);
    const cli = makeCliScript(
      dir,
      'gemini-fail.sh',
      `
if [ "$1" = "--version" ]; then
  exit 0
fi
echo "bad stderr" 1>&2
exit 2
`
    );

    const provider = new GeminiProvider({ cliPath: cli, useAPI: false }) as any;
    await assert.rejects(async () => provider.executeCLI('prompt'), /exited with code 2/);

    provider.cliAvailable = true;
    provider.cliPath = '/definitely/not/exist';
    assert.strictEqual(provider.checkCLIAvailable(), true);
  });

  it('uses static CLI availability cache across instances', () => {
    const cache = (GeminiProvider as any).cliAvailabilityCache as Map<string, boolean>;
    cache.set('/tmp/fake-cli', true);

    const provider = new GeminiProvider({ cliPath: '/tmp/fake-cli', useAPI: false }) as any;
    provider.cliAvailable = undefined;
    assert.strictEqual(provider.checkCLIAvailable(), true);
  });

  it('covers chatCLI/analyzeImageCLI catch branch by throwing non-Error from executeCLI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-catch-'));
    tempDirs.push(dir);
    const img = join(dir, 'a.png');
    writeFileSync(img, 'x');

    const provider = new GeminiProvider({ cliPath: 'gemini-cli', useAPI: false }) as any;
    provider.checkCLIAvailable = () => true;
    provider.executeCLI = async () => {
      throw 'cli-unknown';
    };

    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'x' }]),
      /Unknown error: cli-unknown/,
    );
    await assert.rejects(
      async () => provider.analyzeImage(img, 'x', true),
      /Unknown error: cli-unknown/,
    );
  });

  it('covers executeCLI spawn error branch', async () => {
    const provider = new GeminiProvider({ cliPath: '/definitely/not-exists-cli', useAPI: false }) as any;
    await assert.rejects(
      async () => provider.executeCLI('prompt'),
      /Failed to execute gemini-cli:/,
    );
  });

  it('covers checkCLIAvailable catch path when spawnSync throws', () => {
    const provider = new GeminiProvider({ cliPath: '\u0000', useAPI: false }) as any;
    provider.cliAvailable = undefined;
    assert.strictEqual(provider.checkCLIAvailable(), false);
  });

  it('covers executeCLI timeout callback no-op when already settled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemini-cli-timeout-'));
    tempDirs.push(dir);
    const cli = makeCliScript(
      dir,
      'gemini-timeout.sh',
      `
if [ "$1" = "--version" ]; then
  exit 0
fi
echo "DONE"
exit 0
`,
    );
    const provider = new GeminiProvider({ cliPath: cli, useAPI: false }) as any;

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let timeoutCallback: (() => void) | undefined;
    globalThis.setTimeout = ((cb: (...args: any[]) => void, _ms?: number) => {
      timeoutCallback = () => cb();
      return { __timeout: true } as any;
    }) as any;
    globalThis.clearTimeout = (() => {}) as any;

    try {
      const out = await provider.executeCLI('prompt');
      assert.strictEqual(out, 'DONE');
      assert.ok(timeoutCallback);
      timeoutCallback?.();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('covers executeCLI timeout rejection path', async () => {
    const provider = new GeminiProvider({ cliPath: '/bin/sh', useAPI: false }) as any;

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((cb: (...args: any[]) => void, _ms?: number) => {
      cb();
      return { __timeout: true } as any;
    }) as any;
    globalThis.clearTimeout = (() => {}) as any;

    try {
      await assert.rejects(
        async () => provider.executeCLI('while true; do :; done'),
        /timed out after 60 seconds/,
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
