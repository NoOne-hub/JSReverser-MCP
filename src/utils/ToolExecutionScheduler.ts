import {Mutex} from '../Mutex.js';

export class ToolExecutionScheduler {
  private readonly writeMutex = new Mutex();

  async execute<T>(readOnly: boolean, fn: () => Promise<T>): Promise<T> {
    if (readOnly) {
      return fn();
    }

    const guard = await this.writeMutex.acquire();
    try {
      return await fn();
    } finally {
      guard.dispose();
    }
  }
}
