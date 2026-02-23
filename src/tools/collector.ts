import {zod} from '../third_party/index.js';
import {defineTool} from './ToolDefinition.js';
import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';

export const collectCode = defineTool({
  name: 'collect_code',
  description: 'Collect JavaScript code from a page with smart modes (summary/priority/incremental/full).',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    url: zod.string().url(),
    smartMode: zod.enum(['summary', 'priority', 'incremental', 'full']).optional(),
    returnMode: zod.enum(['full', 'summary', 'pattern', 'top-priority']).optional(),
    includeInline: zod.boolean().optional(),
    includeExternal: zod.boolean().optional(),
    includeDynamic: zod.boolean().optional(),
    maxTotalSize: zod.number().int().positive().optional(),
    maxFileSize: zod.number().int().positive().optional(),
    pattern: zod.string().optional(),
    limit: zod.number().int().positive().optional(),
    topN: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const returnMode = request.params.returnMode ?? 'full';
    let result: unknown;

    if (returnMode === 'summary') {
      result = runtime.collector.getCollectedFilesSummary();
    } else if (returnMode === 'pattern') {
      result = runtime.collector.getFilesByPattern(
        request.params.pattern ?? '.*',
        request.params.limit,
        request.params.maxTotalSize,
      );
    } else if (returnMode === 'top-priority') {
      result = runtime.collector.getTopPriorityFiles(
        request.params.topN,
        request.params.maxTotalSize,
      );
    } else {
      result = await runtime.collector.collect(request.params);
    }

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

function diffSummaries(
  previous: Array<{url: string; size: number; type: string}>,
  current: Array<{url: string; size: number; type: string}>,
  includeUnchanged = false,
): {
  added: Array<{url: string; size: number; type: string}>;
  removed: Array<{url: string; size: number; type: string}>;
  changed: Array<{
    url: string;
    type: string;
    previousSize: number;
    currentSize: number;
    delta: number;
  }>;
  unchanged?: Array<{url: string; size: number; type: string}>;
} {
  const prevMap = new Map(previous.map((item) => [item.url, item]));
  const currentMap = new Map(current.map((item) => [item.url, item]));

  const added: Array<{url: string; size: number; type: string}> = [];
  const removed: Array<{url: string; size: number; type: string}> = [];
  const changed: Array<{
    url: string;
    type: string;
    previousSize: number;
    currentSize: number;
    delta: number;
  }> = [];
  const unchanged: Array<{url: string; size: number; type: string}> = [];

  for (const item of current) {
    const prev = prevMap.get(item.url);
    if (!prev) {
      added.push(item);
      continue;
    }
    if (prev.size !== item.size) {
      changed.push({
        url: item.url,
        type: item.type,
        previousSize: prev.size,
        currentSize: item.size,
        delta: item.size - prev.size,
      });
      continue;
    }
    if (includeUnchanged) {
      unchanged.push(item);
    }
  }

  for (const item of previous) {
    if (!currentMap.has(item.url)) {
      removed.push(item);
    }
  }

  return includeUnchanged ? {added, removed, changed, unchanged} : {added, removed, changed};
}

export const collectionDiff = defineTool({
  name: 'collection_diff',
  description: 'Compare previous and current collected file summaries.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    previous: zod.array(
      zod.object({
        url: zod.string(),
        size: zod.number().int().nonnegative(),
        type: zod.string(),
      }),
    ),
    current: zod
      .array(
        zod.object({
          url: zod.string(),
          size: zod.number().int().nonnegative(),
          type: zod.string(),
        }),
      )
      .optional(),
    includeUnchanged: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const current = request.params.current ?? runtime.collector.getCollectedFilesSummary();
    const diff = diffSummaries(request.params.previous, current, request.params.includeUnchanged);
    const result = {
      previousCount: request.params.previous.length,
      currentCount: current.length,
      addedCount: diff.added.length,
      removedCount: diff.removed.length,
      changedCount: diff.changed.length,
      ...diff,
    };
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const searchInScripts = defineTool({
  name: 'search_in_scripts',
  description: 'Search in collected script cache with regex pattern.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    pattern: zod.string(),
    limit: zod.number().int().positive().optional(),
    maxTotalSize: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = runtime.collector.getFilesByPattern(
      request.params.pattern,
      request.params.limit,
      request.params.maxTotalSize,
    );
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});
