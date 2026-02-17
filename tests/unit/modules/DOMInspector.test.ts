import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DOMInspector } from '../../../src/modules/collector/DOMInspector.js';

function makePage(results: Array<unknown | Error> = []) {
  return {
    evaluate: async () => {
      const next = results.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    waitForSelector: async () => {},
  };
}

describe('DOMInspector', () => {
  it('covers query and structure APIs', async () => {
    const page = makePage([
      { found: true, nodeName: 'BUTTON', textContent: 'OK' },
      [{ found: true, nodeName: 'DIV' }],
      { tag: 'BODY' },
      [{ selector: '#submit', text: 'Submit', type: 'button', visible: true }],
      { color: 'rgb(0,0,0)' },
      { found: true, nodeName: 'DIV', textContent: 'ready' },
      [{ found: true, nodeName: 'SPAN', textContent: 'hello' }],
      '//*[@id="root"]',
      true,
    ]);
    const inspector = new DOMInspector({ getActivePage: async () => page } as any);

    const one = await inspector.querySelector('#submit');
    assert.strictEqual(one.found, true);

    const list = await inspector.querySelectorAll('.row', 5);
    assert.strictEqual(list.length, 1);

    const tree = await inspector.getStructure(2, true);
    assert.deepStrictEqual(tree, { tag: 'BODY' });

    const clickable = await inspector.findClickable('submit');
    assert.strictEqual(clickable.length, 1);

    const style = await inspector.getComputedStyle('#submit');
    assert.strictEqual(style?.color, 'rgb(0,0,0)');

    const waited = await inspector.waitForElement('#ready', 50);
    assert.strictEqual(waited?.found, true);

    const byText = await inspector.findByText('hello', 'span');
    assert.strictEqual(byText.length, 1);

    const xpath = await inspector.getXPath('#root');
    assert.strictEqual(xpath, '//*[@id="root"]');

    const viewport = await inspector.isInViewport('#root');
    assert.strictEqual(viewport, true);
  });

  it('covers observer start/stop and close with cdp session', async () => {
    const page = makePage([undefined, undefined]);
    const inspector = new DOMInspector({ getActivePage: async () => page } as any);

    await inspector.observeDOMChanges({ subtree: true });
    await inspector.stopObservingDOM();

    let detached = 0;
    (inspector as any).cdpSession = {
      detach: async () => {
        detached += 1;
      },
    };
    await inspector.close();
    assert.strictEqual(detached, 1);
    assert.strictEqual((inspector as any).cdpSession, null);
  });

  it('handles failure branches', async () => {
    const failPage = makePage();
    failPage.evaluate = async () => {
      throw new Error('x');
    };
    const inspector = new DOMInspector({ getActivePage: async () => failPage } as any);

    const none = await inspector.querySelector('#none');
    assert.strictEqual(none.found, false);

    const emptyAll = await inspector.querySelectorAll('.none');
    assert.deepStrictEqual(emptyAll, []);

    const structure = await inspector.getStructure();
    assert.strictEqual(structure, null);

    const clickable = await inspector.findClickable();
    assert.deepStrictEqual(clickable, []);

    const style = await inspector.getComputedStyle('#none');
    assert.strictEqual(style, null);

    failPage.waitForSelector = async () => {
      throw new Error('timeout');
    };
    const waited = await inspector.waitForElement('#none', 10);
    assert.strictEqual(waited, null);

    const byText = await inspector.findByText('none');
    assert.deepStrictEqual(byText, []);

    const xpath = await inspector.getXPath('#none');
    assert.strictEqual(xpath, null);

    const viewport = await inspector.isInViewport('#none');
    assert.strictEqual(viewport, false);
  });
});
