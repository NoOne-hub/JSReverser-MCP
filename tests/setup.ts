/**
 * Test setup file
 * Loaded before running tests
 */

process.env.NODE_ENV = 'test';

if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
  };
}
