import {zod} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
import {getJSHookRuntime} from './runtime.js';

type NormalizedHookRecord = {
  target: string;
  event: string;
  method: string;
  url: string;
  status?: number;
  bodySnippet: string;
  timestamp?: number;
};

function normalizeHookRecord(record: Record<string, unknown>): NormalizedHookRecord {
  const body = typeof record.body === 'string'
    ? record.body
    : typeof record.requestBody === 'string'
      ? record.requestBody
      : typeof record.data === 'string'
        ? record.data
        : '';
  return {
    target: typeof record.target === 'string' ? record.target : 'unknown',
    event: typeof record.event === 'string' ? record.event : '',
    method: typeof record.method === 'string' ? record.method.toUpperCase() : '',
    url: typeof record.url === 'string' ? record.url : '',
    status: typeof record.status === 'number' ? record.status : undefined,
    bodySnippet: body.slice(0, 200),
    timestamp: typeof record.timestamp === 'number' ? record.timestamp : undefined,
  };
}

function normalizeRecordForDedupe(record: NormalizedHookRecord): {key: string; summary: NormalizedHookRecord} {
  const key = [record.target, record.event, record.method, record.url, record.bodySnippet.slice(0, 256)].join('::');
  return {key, summary: record};
}

function summarizeHookRecords(records: Array<NormalizedHookRecord>, maxRecords: number): {
  total: number;
  unique: number;
  dropped: number;
  records: Array<Record<string, unknown>>;
} {
  const byKey = new Map<string, {count: number; sample: Record<string, unknown>}>();
  for (const record of records) {
    const normalized = normalizeRecordForDedupe(record);
    const existing = byKey.get(normalized.key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(normalized.key, {count: 1, sample: normalized.summary});
  }

  const deduped = Array.from(byKey.values()).map((item) => ({
    ...item.sample,
    count: item.count,
  }));
  deduped.sort((a, b) => Number(b.count) - Number(a.count));
  const limited = deduped.slice(0, maxRecords);
  return {
    total: records.length,
    unique: deduped.length,
    dropped: deduped.length - limited.length,
    records: limited,
  };
}

export const createHook = defineTool({
  name: 'create_hook',
  description: 'Create hook script for function/fetch/xhr/property/cookie/websocket/eval/timer.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    type: zod.string(),
    params: zod.record(zod.string(), zod.unknown()).optional(),
    description: zod.string().optional(),
    action: zod.enum(['log', 'block', 'modify', 'passthrough']).optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = runtime.hookManager.create(request.params);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const injectHook = defineTool({
  name: 'inject_hook',
  description: 'Inject an existing hook into the current page.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {hookId: zod.string()},
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const hook = runtime.hookManager.getHook(request.params.hookId);
    if (!hook) {
      throw new Error(`Hook not found: ${request.params.hookId}`);
    }
    await runtime.pageController.injectScript(hook.script);
    response.appendResponseLine(`Hook injected: ${hook.hookId}`);
  },
});

export const getHookData = defineTool({
  name: 'get_hook_data',
  description: 'Get captured data for one hook or all hooks. Supports raw view and summary view for noise reduction.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    hookId: zod.string().optional(),
    view: zod.enum(['raw', 'summary']).optional(),
    maxRecords: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const view = request.params.view ?? 'raw';
    const maxRecords = request.params.maxRecords ?? 100;
    let data: unknown;
    if (request.params.hookId) {
      const records = (runtime.hookManager.getRecords(request.params.hookId) as Array<Record<string, unknown>>)
        .map(normalizeHookRecord);
      data = view === 'summary'
        ? summarizeHookRecords(records, maxRecords)
        : records;
    } else if (view === 'summary') {
      const hooks = runtime.hookManager.getAllHooks();
      data = hooks.map((hook) => {
        const records = (runtime.hookManager.getRecords(hook.hookId) as Array<Record<string, unknown>>)
          .map(normalizeHookRecord);
        return {
          hookId: hook.hookId,
          ...summarizeHookRecords(records, maxRecords),
        };
      });
    } else {
      data = runtime.hookManager.exportData('json');
    }
    response.appendResponseLine('```json');
    response.appendResponseLine(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    response.appendResponseLine('```');
  },
});

export const removeHook = defineTool({
  name: 'remove_hook',
  description: 'Remove a hook by id.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {hookId: zod.string()},
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const removed = runtime.hookManager.remove(request.params.hookId);
    response.appendResponseLine(removed ? 'Hook removed.' : 'Hook not found.');
  },
});
