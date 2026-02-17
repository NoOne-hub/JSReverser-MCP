import {zod} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
import {getJSHookRuntime} from './runtime.js';
import {TokenBudgetManager} from '../../utils/TokenBudgetManager.js';

export const deobfuscateCode = defineTool({
  name: 'deobfuscate_code',
  description: 'AI-assisted JavaScript deobfuscation.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string(),
    aggressive: zod.boolean().optional(),
    renameVariables: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.deobfuscator.deobfuscate(request.params);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const understandCode = defineTool({
  name: 'understand_code',
  description: 'Analyze code structure/business/security with AI + static analysis.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string(),
    focus: zod.enum(['all', 'structure', 'business', 'security']).optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.analyzer.understand(request.params);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const summarizeCode = defineTool({
  name: 'summarize_code',
  description: 'Summarize one code file, multiple files, or project-level context.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    mode: zod.enum(['single', 'batch', 'project']).default('single'),
    code: zod.string().optional(),
    url: zod.string().optional(),
    files: zod.array(zod.object({
      url: zod.string(),
      content: zod.string(),
      size: zod.number().int().nonnegative(),
      type: zod.enum(['inline', 'external', 'dynamic', 'service-worker', 'web-worker']),
    })).optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();

    if (request.params.mode === 'project') {
      const result = await runtime.summarizer.summarizeProject(request.params.files ?? []);
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
      return;
    }

    if (request.params.mode === 'batch') {
      const result = await runtime.summarizer.summarizeBatch(request.params.files ?? []);
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(result, null, 2));
      response.appendResponseLine('```');
      return;
    }

    const file = {
      url: request.params.url ?? 'inline-input.js',
      content: request.params.code ?? '',
      size: (request.params.code ?? '').length,
      type: 'inline' as const,
    };
    const result = await runtime.summarizer.summarizeFile(file);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const detectCrypto = defineTool({
  name: 'detect_crypto',
  description: 'Detect cryptographic algorithms/libraries from JavaScript source.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string(),
    useAI: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.cryptoDetector.detect(request.params);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

function normalizeCollectedFiles(result: unknown): Array<{url: string; content: string; size: number; type: string}> {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const files = (result as {files?: unknown}).files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .filter((item): item is {url?: unknown; content?: unknown; size?: unknown; type?: unknown} => Boolean(item && typeof item === 'object'))
    .map((file) => ({
      url: typeof file.url === 'string' ? file.url : 'unknown',
      content: typeof file.content === 'string' ? file.content : '',
      size: typeof file.size === 'number' ? file.size : (typeof file.content === 'string' ? file.content.length : 0),
      type: typeof file.type === 'string' ? file.type : 'external',
    }));
}

function buildHookTimeline(hookRecords: Array<{hookId: string; records: Array<Record<string, unknown>>}>): Array<{
  hookId: string;
  target: string;
  url?: string;
  event?: string;
  method?: string;
  status?: number;
  signatureIndicators?: string[];
  timestamp: number;
}> {
  const findSignatureIndicators = (value: unknown): string[] => {
    if (typeof value !== 'string' || value.length === 0) {
      return [];
    }
    const text = value.toLowerCase();
    const indicators = ['sign', 'signature', 'token', 'auth', 'x-sign', 'hmac', 'nonce']
      .filter((keyword) => text.includes(keyword));
    return [...new Set(indicators)];
  };

  const timeline = hookRecords.flatMap((entry) =>
    entry.records.map((record) => ({
      hookId: entry.hookId,
      target: typeof record.target === 'string' ? record.target : 'unknown',
      url: typeof record.url === 'string' ? record.url : undefined,
      event: typeof record.event === 'string' ? record.event : undefined,
      method: typeof record.method === 'string' ? record.method.toUpperCase() : undefined,
      status: typeof record.status === 'number' ? record.status : undefined,
      signatureIndicators: [
        ...findSignatureIndicators(record.url),
        ...findSignatureIndicators(record.method),
        ...findSignatureIndicators(record.body),
        ...findSignatureIndicators(record.requestBody),
        ...findSignatureIndicators(record.data),
      ],
      timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
    })),
  );
  timeline.sort((a, b) => a.timestamp - b.timestamp);
  return timeline;
}

function correlateNetworkFlows(
  timeline: Array<{
    hookId: string;
    target: string;
    url?: string;
    event?: string;
    method?: string;
    status?: number;
    signatureIndicators?: string[];
    timestamp: number;
  }>,
  timeWindowMs: number,
  maxFlows: number,
): Array<{
  url: string;
  method: string;
  firstTimestamp: number;
  lastTimestamp: number;
  eventCount: number;
  hookIds: string[];
  events: string[];
  statuses: number[];
  signatureIndicators: string[];
}> {
  const buckets: Array<{
    key: string;
    url: string;
    method: string;
    firstTimestamp: number;
    lastTimestamp: number;
    eventCount: number;
    hookIds: Set<string>;
    events: Set<string>;
    statuses: Set<number>;
    signatureIndicators: Set<string>;
  }> = [];

  for (const item of timeline) {
    if (!item.url) {
      continue;
    }
    const method = item.method ?? (item.target === 'websocket' ? 'WS' : 'UNKNOWN');
    const key = `${item.url}::${method}`;
    const eventName = item.event ?? item.target;
    const existing = buckets.find(
      (bucket) => bucket.key === key && item.timestamp - bucket.lastTimestamp <= timeWindowMs,
    );

    if (existing) {
      existing.lastTimestamp = item.timestamp;
      existing.eventCount += 1;
      existing.hookIds.add(item.hookId);
      existing.events.add(eventName);
      if (typeof item.status === 'number') {
        existing.statuses.add(item.status);
      }
      for (const indicator of item.signatureIndicators ?? []) {
        existing.signatureIndicators.add(indicator);
      }
      continue;
    }

    buckets.push({
      key,
      url: item.url,
      method,
      firstTimestamp: item.timestamp,
      lastTimestamp: item.timestamp,
      eventCount: 1,
      hookIds: new Set([item.hookId]),
      events: new Set([eventName]),
      statuses: typeof item.status === 'number' ? new Set([item.status]) : new Set(),
      signatureIndicators: new Set(item.signatureIndicators ?? []),
    });
  }

  return buckets
    .sort((a, b) => b.eventCount - a.eventCount || b.lastTimestamp - a.lastTimestamp)
    .slice(0, maxFlows)
    .map((bucket) => ({
      url: bucket.url,
      method: bucket.method,
      firstTimestamp: bucket.firstTimestamp,
      lastTimestamp: bucket.lastTimestamp,
      eventCount: bucket.eventCount,
      hookIds: Array.from(bucket.hookIds),
      events: Array.from(bucket.events),
      statuses: Array.from(bucket.statuses),
      signatureIndicators: Array.from(bucket.signatureIndicators),
    }));
}

function buildUrlPattern(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const normalizedPath = parsed.pathname
      .replace(/\/\d{2,}(?=\/|$)/g, '/:num')
      .replace(/\/[a-f0-9]{8,}(?=\/|$)/gi, '/:hex');
    const queryKeys = Array.from(parsed.searchParams.keys()).sort();
    const queryPattern = queryKeys.length > 0 ? `?${queryKeys.join('&')}` : '';
    return `${parsed.origin}${normalizedPath || '/'}${queryPattern}`;
  } catch {
    return rawUrl
      .split('?')[0]
      .replace(/\/\d{2,}(?=\/|$)/g, '/:num')
      .replace(/\/[a-f0-9]{8,}(?=\/|$)/gi, '/:hex');
  }
}

function buildRequestFingerprints(
  flows: Array<{
    url: string;
    method: string;
    eventCount: number;
    statuses: number[];
    signatureIndicators: string[];
  }>,
  maxFingerprints: number,
): Array<{
  fingerprint: string;
  urlPattern: string;
  methods: string[];
  flowCount: number;
  totalEvents: number;
  signatureIndicators: string[];
  signatureIndicatorCount: number;
  suspiciousScore: number;
  sampleUrls: string[];
}> {
  const buckets = new Map<string, {
    urlPattern: string;
    methods: Set<string>;
    flowCount: number;
    totalEvents: number;
    signatureIndicators: Set<string>;
    suspiciousScore: number;
    sampleUrls: Set<string>;
  }>();

  for (const flow of flows) {
    const urlPattern = buildUrlPattern(flow.url);
    const key = urlPattern;
    const existing = buckets.get(key);
    const flowScore =
      Math.min(flow.eventCount, 10) +
      Math.min(flow.signatureIndicators.length, 5) * 3 +
      (flow.statuses.some((status) => status >= 400) ? 2 : 0);

    if (existing) {
      existing.methods.add(flow.method);
      existing.flowCount += 1;
      existing.totalEvents += flow.eventCount;
      existing.suspiciousScore += flowScore;
      for (const indicator of flow.signatureIndicators) {
        existing.signatureIndicators.add(indicator);
      }
      existing.sampleUrls.add(flow.url);
      continue;
    }

    buckets.set(key, {
      urlPattern,
      methods: new Set([flow.method]),
      flowCount: 1,
      totalEvents: flow.eventCount,
      signatureIndicators: new Set(flow.signatureIndicators),
      suspiciousScore: flowScore,
      sampleUrls: new Set([flow.url]),
    });
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.suspiciousScore - a.suspiciousScore || b.totalEvents - a.totalEvents)
    .slice(0, maxFingerprints)
    .map((bucket) => {
      const methods = Array.from(bucket.methods).sort();
      const signatureIndicators = Array.from(bucket.signatureIndicators).sort();
      const fingerprint = `${methods.join('+')} ${bucket.urlPattern}`.trim();
      return {
        fingerprint,
        urlPattern: bucket.urlPattern,
        methods,
        flowCount: bucket.flowCount,
        totalEvents: bucket.totalEvents,
        signatureIndicators,
        signatureIndicatorCount: signatureIndicators.length,
        suspiciousScore: bucket.suspiciousScore,
        sampleUrls: Array.from(bucket.sampleUrls).slice(0, 3),
      };
    });
}

function buildPriorityTargets(input: {
  requestFingerprints: Array<{
    urlPattern: string;
    methods: string[];
    suspiciousScore: number;
    signatureIndicatorCount: number;
  }>;
  signatureHints: {signatureParams: string[]; candidateFunctions: string[]; requestSinks: string[]};
  maxTargets: number;
}): Array<{target: string; type: 'network' | 'function'; priorityScore: number; reasons: string[]}> {
  const networkTargets = input.requestFingerprints.map((item) => {
    const isWritePath = item.methods.some((method) => ['POST', 'PUT', 'PATCH', 'DELETE', 'WS'].includes(method));
    const score =
      item.suspiciousScore +
      item.signatureIndicatorCount * 2 +
      (isWritePath ? 3 : 0) +
      (input.signatureHints.requestSinks.length > 0 ? 1 : 0);
    return {
      target: item.urlPattern,
      type: 'network' as const,
      priorityScore: score,
      reasons: [
        item.signatureIndicatorCount > 0 ? `signature indicators: ${item.signatureIndicatorCount}` : null,
        isWritePath ? `write-like methods: ${item.methods.join(', ')}` : null,
      ].filter((value): value is string => Boolean(value)),
    };
  });

  const functionTargets = input.signatureHints.candidateFunctions.slice(0, 5).map((name) => ({
    target: name,
    type: 'function' as const,
    priorityScore: 6 + Math.min(input.signatureHints.signatureParams.length, 4),
    reasons: [
      'name matches signing/encryption keywords',
      input.signatureHints.signatureParams.length > 0 ? `related params: ${input.signatureHints.signatureParams.slice(0, 4).join(', ')}` : null,
    ].filter((value): value is string => Boolean(value)),
  }));

  return [...networkTargets, ...functionTargets]
    .sort((a, b) => b.priorityScore - a.priorityScore || a.target.localeCompare(b.target))
    .slice(0, input.maxTargets);
}

function extractSignatureChainHints(code: string): {
  signatureParams: string[];
  candidateFunctions: string[];
  requestSinks: string[];
} {
  const signatureParamRegex = /\b(sign(?:ature)?|token|auth|nonce|timestamp|x-sign)\b/gi;
  const functionNameRegex = /(function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(|([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function)/g;
  const requestSinkRegex = /\b(fetch|XMLHttpRequest|sendBeacon|axios\.(?:get|post|request)|\$.ajax)\b/g;

  const params = new Set<string>();
  for (const match of code.matchAll(signatureParamRegex)) {
    if (match[1]) {
      params.add(match[1].toLowerCase());
    }
  }

  const functions = new Set<string>();
  for (const match of code.matchAll(functionNameRegex)) {
    const name = match[2] || match[3] || match[4];
    if (name && /(sign|token|encrypt|hash|auth|nonce|hmac|md5|sha)/i.test(name)) {
      functions.add(name);
    }
  }

  const sinks = new Set<string>();
  for (const match of code.matchAll(requestSinkRegex)) {
    if (match[1]) {
      sinks.add(match[1]);
    }
  }

  return {
    signatureParams: Array.from(params).slice(0, 20),
    candidateFunctions: Array.from(functions).slice(0, 20),
    requestSinks: Array.from(sinks).slice(0, 20),
  };
}

function buildActionPlan(result: {
  target: string;
  topHookIds: Array<{hookId: string; type: string}>;
  suspiciousFlows: Array<{url: string; method: string; signatureIndicators: string[]}>;
  priorityTargets: Array<{target: string; type: 'network' | 'function'; priorityScore: number}>;
  signatureHints: {signatureParams: string[]; candidateFunctions: string[]; requestSinks: string[]};
}): string[] {
  const steps: string[] = [];
  const addStep = (text: string) => {
    steps.push(`${steps.length + 1}) ${text}`);
  };
  addStep(`调用 collect_code，参数: {"url":"${result.target}","returnMode":"top-priority","topN":10}`);

  if (result.suspiciousFlows.length > 0) {
    const flow = result.suspiciousFlows[0];
    addStep(`重点观察可疑请求: ${flow.method} ${flow.url}，命中指标: ${flow.signatureIndicators.join(', ')}`);
  } else {
    addStep('先触发登录/下单/关键业务操作，再重新运行 analyze_target 捕获动态请求');
  }

  if (result.priorityTargets.length > 0) {
    const top = result.priorityTargets[0];
    if (top.type === 'network') {
      addStep(`优先复现网络链路: ${top.target}（priority=${top.priorityScore}）`);
    } else {
      addStep(`优先审计函数: ${top.target}（priority=${top.priorityScore}）`);
    }
  }

  if (result.signatureHints.candidateFunctions.length > 0) {
    const fnName = result.signatureHints.candidateFunctions[0];
    addStep(`使用 search_in_scripts 搜索函数名 "${fnName}"，并用 understand_code 深挖调用链`);
  } else {
    addStep('使用 search_in_scripts 搜索关键词 sign/token/auth/nonce，定位签名生成点');
  }

  if (result.topHookIds.length > 0) {
    addStep(`调用 get_hook_data 查看首个 hook 数据: {"hookId":"${result.topHookIds[0].hookId}"}`);
  } else {
    addStep('用 create_hook + inject_hook 手工注入 fetch/xhr hook 后再采样');
  }

  addStep('对疑似签名代码调用 deobfuscate_code（aggressive=true）并复测请求参数变化');
  return steps;
}

export const analyzeTarget = defineTool({
  name: 'analyze_target',
  description: 'One-shot reverse workflow: collect code, run security/crypto analysis, optional deobfuscation, and hook timeline correlation.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    url: zod.string().url(),
    topN: zod.number().int().positive().optional(),
    useAI: zod.boolean().optional(),
    runDeobfuscation: zod.boolean().optional(),
    hookPreset: zod.enum(['none', 'api-signature', 'network-core']).optional(),
    autoInjectHooks: zod.boolean().optional(),
    waitAfterHookMs: zod.number().int().nonnegative().optional(),
    correlationWindowMs: zod.number().int().positive().optional(),
    maxCorrelatedFlows: zod.number().int().positive().optional(),
    maxFingerprints: zod.number().int().positive().optional(),
    collect: zod.object({
      smartMode: zod.enum(['summary', 'priority', 'incremental', 'full']).optional(),
      includeInline: zod.boolean().optional(),
      includeExternal: zod.boolean().optional(),
      includeDynamic: zod.boolean().optional(),
      maxTotalSize: zod.number().int().positive().optional(),
      maxFileSize: zod.number().int().positive().optional(),
    }).optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const startedAt = Date.now();
    const topN = request.params.topN ?? 8;
    const hookPreset = request.params.hookPreset ?? 'api-signature';
    const autoInjectHooks = request.params.autoInjectHooks ?? true;
    const correlationWindowMs = request.params.correlationWindowMs ?? 1500;
    const maxCorrelatedFlows = request.params.maxCorrelatedFlows ?? 20;
    const maxFingerprints = request.params.maxFingerprints ?? 12;

    const collectResult = await runtime.collector.collect({
      url: request.params.url,
      smartMode: request.params.collect?.smartMode ?? 'priority',
      includeInline: request.params.collect?.includeInline,
      includeExternal: request.params.collect?.includeExternal,
      includeDynamic: request.params.collect?.includeDynamic ?? true,
      maxTotalSize: request.params.collect?.maxTotalSize,
      maxFileSize: request.params.collect?.maxFileSize,
    });

    const normalizedFiles = normalizeCollectedFiles(collectResult);
    const topPriority = runtime.collector.getTopPriorityFiles(topN);
    const candidateFiles = topPriority.files.length > 0
      ? topPriority.files
      : normalizedFiles.slice(0, topN);
    const mergedCode = candidateFiles.map((file) => `// ${file.url}\n${file.content}`).join('\n\n');
    const analysisCode = mergedCode.length > 300000 ? mergedCode.slice(0, 300000) : mergedCode;

    const hookTypes = hookPreset === 'none'
      ? []
      : hookPreset === 'network-core'
        ? ['fetch', 'xhr', 'websocket', 'eval', 'timer']
        : ['fetch', 'xhr', 'websocket'];

    const injectedHooks: Array<{hookId: string; type: string}> = [];
    for (const type of hookTypes) {
      const created = runtime.hookManager.create({
        type,
        description: `[analyze_target] ${type} hook`,
        action: 'log',
      });
      if (autoInjectHooks) {
        await runtime.pageController.injectScript(created.script);
      }
      injectedHooks.push({hookId: created.hookId, type});
    }

    if (request.params.waitAfterHookMs && request.params.waitAfterHookMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, request.params.waitAfterHookMs));
    }

    const [understand, crypto] = await Promise.all([
      runtime.analyzer.understand({code: analysisCode, focus: 'security'}),
      runtime.cryptoDetector.detect({code: analysisCode, useAI: request.params.useAI} as any),
    ]);

    const deobfuscation = request.params.runDeobfuscation
      ? await runtime.deobfuscator.deobfuscate({
          code: analysisCode.slice(0, 120000),
          aggressive: true,
          renameVariables: true,
        })
      : undefined;

    const hookRecords = injectedHooks.map((hook) => ({
      hookId: hook.hookId,
      records: runtime.hookManager.getRecords(hook.hookId),
    }));
    const hookTimeline = buildHookTimeline(hookRecords as Array<{hookId: string; records: Array<Record<string, unknown>>}>);
    const urlActivity = hookTimeline.reduce<Record<string, number>>((acc, item) => {
      if (item.url) {
        acc[item.url] = (acc[item.url] ?? 0) + 1;
      }
      return acc;
    }, {});
    const activeUrls = Object.entries(urlActivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([url, count]) => ({url, count}));
    const correlatedFlows = correlateNetworkFlows(hookTimeline, correlationWindowMs, maxCorrelatedFlows);
    const suspiciousFlows = correlatedFlows.filter((flow) => flow.signatureIndicators.length > 0);
    const requestFingerprints = buildRequestFingerprints(correlatedFlows, maxFingerprints);
    const signatureHints = extractSignatureChainHints(analysisCode);
    const priorityTargets = buildPriorityTargets({
      requestFingerprints,
      signatureHints,
      maxTargets: 10,
    });
    const actionPlan = buildActionPlan({
      target: request.params.url,
      topHookIds: injectedHooks,
      suspiciousFlows,
      priorityTargets,
      signatureHints,
    });
    const collectionDependencies =
      collectResult && typeof collectResult === 'object'
        ? (collectResult as any).dependencies
        : undefined;

    const result = {
      target: request.params.url,
      durationMs: Date.now() - startedAt,
      collection: {
        totalCollected: normalizedFiles.length,
        selectedForAnalysis: candidateFiles.length,
        dependencies: collectionDependencies ?? {nodes: [], edges: []},
      },
      analysis: {
        qualityScore: understand.qualityScore,
        securityRiskCount: understand.securityRisks.length,
        cryptoAlgorithms: crypto.algorithms.map((item) => item.name),
      },
      deobfuscation: deobfuscation
        ? {
            confidence: deobfuscation.confidence,
            readabilityScore: deobfuscation.readabilityScore,
            transformations: deobfuscation.transformations.length,
          }
        : null,
      hooks: {
        preset: hookPreset,
        autoInjected: autoInjectHooks,
        hookIds: injectedHooks,
        totalRecords: hookTimeline.length,
        activeUrls,
        correlatedFlows,
        suspiciousFlows: suspiciousFlows.slice(0, 10),
        timelineSample: hookTimeline.slice(0, 30),
      },
      requestFingerprints,
      priorityTargets,
      signatureChain: {
        params: signatureHints.signatureParams,
        candidateFunctions: signatureHints.candidateFunctions,
        requestSinks: signatureHints.requestSinks,
      },
      actionPlan,
      nextActions: [
        crypto.algorithms.length > 0 ? 'Focus on crypto-related files from top-priority list.' : null,
        hookTimeline.length === 0 ? 'Trigger page interactions and rerun get_hook_data / analyze_target.' : null,
        understand.securityRisks.length > 0 ? 'Review high-severity security findings and verify call stacks.' : null,
      ].filter((item): item is string => Boolean(item)),
    };

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

function toMarkdownReport(report: {
  generatedAt: string;
  collector: {
    totalFiles: number;
    totalBytes: number;
  };
  hooks: {
    totalHooks: number;
    enabledHooks: number;
    totalRecords: number;
  };
  tokenBudget: {
    usedTokens: number;
    maxTokens: number;
    usagePercent: number;
  };
}): string {
  return [
    '# Session Report',
    '',
    `Generated At: ${report.generatedAt}`,
    '',
    '## Collector',
    `- Files: ${report.collector.totalFiles}`,
    `- Total Bytes: ${report.collector.totalBytes}`,
    '',
    '## Hooks',
    `- Total Hooks: ${report.hooks.totalHooks}`,
    `- Enabled Hooks: ${report.hooks.enabledHooks}`,
    `- Total Records: ${report.hooks.totalRecords}`,
    '',
    '## Token Budget',
    `- Used: ${report.tokenBudget.usedTokens}/${report.tokenBudget.maxTokens}`,
    `- Usage: ${report.tokenBudget.usagePercent.toFixed(2)}%`,
  ].join('\n');
}

export const riskPanel = defineTool({
  name: 'risk_panel',
  description: 'Build a combined risk score from analyzer, crypto detector and hook signals.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    code: zod.string().optional(),
    useAI: zod.boolean().optional(),
    includeHookSignals: zod.boolean().optional(),
    hookId: zod.string().optional(),
    topN: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();

    let code = request.params.code;
    if (!code) {
      const top = runtime.collector.getTopPriorityFiles(request.params.topN ?? 5);
      if (top.files.length === 0) {
        throw new Error('No code provided and no collected files found. Run collect_code first.');
      }
      code = top.files.map((file) => `// ${file.url}\n${file.content}`).join('\n\n');
    }

    const [understand, crypto] = await Promise.all([
      runtime.analyzer.understand({code, focus: 'security'}),
      runtime.cryptoDetector.detect({code, useAI: request.params.useAI} as any),
    ]);

    const securityRisks = Array.isArray(understand.securityRisks) ? understand.securityRisks : [];
    const highSeverityCount = securityRisks.filter((risk) => risk.severity === 'critical' || risk.severity === 'high').length;
    const cryptoIssues = Array.isArray((crypto as any).securityIssues) ? (crypto as any).securityIssues : [];
    const algorithms = Array.isArray((crypto as any).algorithms) ? (crypto as any).algorithms : [];
    const dangerousAlgorithms = algorithms.filter((algo: any) =>
      ['md5', 'sha1', 'rc4', 'des'].includes(String(algo.name).toLowerCase()),
    );

    let hookSignalCount = 0;
    if (request.params.includeHookSignals !== false) {
      if (request.params.hookId) {
        hookSignalCount = runtime.hookManager.getRecords(request.params.hookId).length;
      } else {
        hookSignalCount = runtime.hookManager
          .getAllHooks()
          .reduce((sum, hook) => sum + runtime.hookManager.getRecords(hook.hookId).length, 0);
      }
    }

    const rawScore =
      highSeverityCount * 20 +
      cryptoIssues.length * 15 +
      dangerousAlgorithms.length * 10 +
      Math.min(hookSignalCount, 10) * 2;
    const score = Math.max(0, Math.min(100, rawScore));
    const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

    const result = {
      score,
      level,
      factors: {
        securityRisks: securityRisks.length,
        highSeverityRisks: highSeverityCount,
        cryptoAlgorithms: algorithms.length,
        cryptoIssues: cryptoIssues.length,
        dangerousAlgorithms: dangerousAlgorithms.map((algo: any) => algo.name),
        hookSignals: hookSignalCount,
      },
      recommendations: [
        highSeverityCount > 0 ? 'Prioritize high-severity security findings first.' : null,
        dangerousAlgorithms.length > 0 ? 'Replace weak crypto algorithms (MD5/SHA1/RC4/DES).' : null,
        hookSignalCount > 0 ? 'Review hook records to confirm if suspicious paths are expected.' : null,
      ].filter((item): item is string => Boolean(item)),
    };

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const exportSessionReport = defineTool({
  name: 'export_session_report',
  description: 'Export current reverse-engineering session as JSON or Markdown.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    format: zod.enum(['json', 'markdown']).default('json'),
    includeHookData: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const summaries = runtime.collector.getCollectedFilesSummary();
    const collectorStats = await runtime.collector.getAllStats();
    const hookStats = runtime.hookManager.getStats();
    const totalHookRecords = hookStats.hooks.reduce(
      (sum, hook) => sum + runtime.hookManager.getRecords(hook.hookId).length,
      0,
    );
    const tokenStats = TokenBudgetManager.getInstance().getStats();

    const report = {
      generatedAt: new Date().toISOString(),
      collector: {
        totalFiles: summaries.length,
        totalBytes: summaries.reduce((sum, file) => sum + file.size, 0),
        cacheStats: collectorStats,
      },
      hooks: {
        ...hookStats,
        totalRecords: totalHookRecords,
      },
      tokenBudget: {
        usedTokens: tokenStats.currentUsage,
        maxTokens: tokenStats.maxTokens,
        usagePercent: tokenStats.usagePercentage,
      },
      hookData: request.params.includeHookData ? runtime.hookManager.exportData('json') : undefined,
    };

    if (request.params.format === 'markdown') {
      const markdown = toMarkdownReport(report);
      response.appendResponseLine(markdown);
      return;
    }

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(report, null, 2));
    response.appendResponseLine('```');
  },
});
