import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { logger, saveLogsToFile } from '../../../src/logger.js';

describe('root logger', () => {
  it('saves debug logs to a file', async () => {
    const dir = path.resolve('js-reverse-mcp-main/tests/.tmp/root-logger');
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `log-${Date.now()}.txt`);
    const stream = saveLogsToFile(file);

    logger('hello from logger test');

    await new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });

    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(content.includes('hello from logger test'));
  });

  it('handles write stream error callback by ending stream and exiting', () => {
    const originalCreate = fs.createWriteStream;
    const originalExit = process.exit;
    const originalConsoleError = console.error;

    let errorHandler: ((err: Error) => void) | null = null;
    let endCalled = 0;
    const fakeStream = {
      write: () => true,
      on: (event: string, cb: (err: Error) => void) => {
        if (event === 'error') {
          errorHandler = cb;
        }
        return fakeStream as any;
      },
      end: () => {
        endCalled += 1;
      },
    } as any;

    (fs as any).createWriteStream = () => fakeStream;
    let exitCode: number | null = null;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error('__exit_called__');
    };
    let errorLogged = '';
    console.error = (msg?: any) => {
      errorLogged = String(msg ?? '');
    };

    try {
      saveLogsToFile('/tmp/fake-log.txt');
      assert.ok(errorHandler);
      assert.throws(() => errorHandler!(new Error('disk full')), /__exit_called__/);
      assert.strictEqual(endCalled, 1);
      assert.strictEqual(exitCode, 1);
      assert.ok(errorLogged.includes('Error when opening/writing to log file'));
    } finally {
      (fs as any).createWriteStream = originalCreate;
      (process as any).exit = originalExit;
      console.error = originalConsoleError;
    }
  });
});
