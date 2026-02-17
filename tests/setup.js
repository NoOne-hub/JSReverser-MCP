/**
 * Test setup file
 * Loaded before running tests
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
  };
}
