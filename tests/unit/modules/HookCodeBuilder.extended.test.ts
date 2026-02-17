import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HookCodeBuilder } from '../../../src/modules/hook/HookCodeBuilder.js';

describe('HookCodeBuilder extended', () => {
  it('builds rich hook code with capture/conditions/lifecycle/store', () => {
    const code = new HookCodeBuilder('h1')
      .intercept('window.fetch', 'fetch')
      .describe('fetch hook')
      .action('log')
      .captureAll(3)
      .when('args.length > 0')
      .maxCalls(10)
      .minInterval(100)
      .before('hookData.before = true;')
      .after('hookData.after = true;')
      .onError('hookData.err = true;')
      .onFinally('hookData.finally = true;')
      .storeTo('__store', 5)
      .console(true, 'full')
      .serializer('return {t: hookData.target};')
      .async(true)
      .build();

    assert.ok(code.includes('window.fetch'));
    assert.ok(code.includes('__callCount'));
    assert.ok(code.includes('hookData.before'));
    assert.ok(code.includes('__store'));
  });

  it('supports replace-mode build', () => {
    const code = new HookCodeBuilder('h2')
      .intercept('window.alert')
      .replace('return originalFn(...args);')
      .build();
    assert.ok(code.includes('Replaced'));
    assert.ok(code.includes('originalFn'));
  });

  it('throws when target is missing', () => {
    assert.throws(() => new HookCodeBuilder('h3').build(), /Hook target is required/);
  });

  it('can roundtrip config via fromConfig/getConfig', () => {
    const builder = new HookCodeBuilder('h4').intercept('window.setTimeout').captureArgs();
    const config = builder.getConfig();
    const restored = HookCodeBuilder.fromConfig(config);
    const code = restored.build();
    assert.ok(code.includes('window.setTimeout'));
  });
});

