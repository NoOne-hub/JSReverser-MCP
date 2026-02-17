import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AISummarizer } from '../../../src/modules/analyzer/AISummarizer.js';

describe('AISummarizer', () => {
  const file = {
    url: 'https://example.com/app.js',
    type: 'external' as const,
    size: 120,
    content: 'function run(){ return fetch("/api") }\nconst pwd="secret123456";',
  };

  it('summarizes file from AI JSON response', async () => {
    const llm = {
      chat: async () => ({
        content: JSON.stringify({
          summary: 'desc',
          purpose: 'purpose',
          keyFunctions: ['run'],
          dependencies: ['axios'],
          hasEncryption: true,
          hasAPI: true,
          hasObfuscation: false,
          complexity: 'medium',
        }),
      }),
    };
    const s = new AISummarizer(llm as any);
    const out = await s.summarizeFile(file as any);
    assert.strictEqual(out.summary, 'desc');
    assert.strictEqual(out.purpose, 'purpose');
    assert.strictEqual(out.hasAPI, true);
  });

  it('falls back to basic analysis on AI failure', async () => {
    const llm = {
      chat: async () => {
        throw new Error('ai down');
      },
    };
    const s = new AISummarizer(llm as any);
    const out = await s.summarizeFile(file as any);
    assert.strictEqual(out.summary.includes('Basic analysis'), true);
    assert.ok(Array.isArray(out.keyFunctions));
  });

  it('summarizes batches and project metadata', async () => {
    const llm = {
      chat: async () => ({
        content: JSON.stringify({
          mainPurpose: 'project',
          architecture: 'SPA',
          technologies: ['React'],
          securityConcerns: ['xss'],
          recommendations: ['sanitize'],
        }),
      }),
    };
    const s = new AISummarizer(llm as any);
    const batch = await s.summarizeBatch([file as any, file as any], 1);
    assert.strictEqual(batch.length, 2);

    const project = await s.summarizeProject([file as any, file as any]);
    assert.strictEqual(project.totalFiles, 2);
    assert.strictEqual(project.architecture, 'SPA');
  });

  it('uses safe fallback when project JSON is invalid', async () => {
    const llm = {
      chat: async () => ({ content: 'not-json' }),
    };
    const s = new AISummarizer(llm as any);
    const project = await s.summarizeProject([file as any]);
    assert.strictEqual(project.mainPurpose, 'Analysis failed');
  });
});

