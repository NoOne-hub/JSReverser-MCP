/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './polyfill.js';

import type {Channel} from './browser.js';
import {
  ensureBrowserConnected,
  ensureBrowserLaunched,
  resolveAutoConnectTarget,
} from './browser.js';
import {executeKnowledgeCliCommand, parseArguments} from './cli.js';
import {features} from './features.js';
import {loadIssueDescriptions} from './issue-descriptions.js';
import {logger, saveLogsToFile} from './logger.js';
import {McpContext} from './McpContext.js';
import {McpResponse} from './McpResponse.js';
import {
  McpServer,
  StdioServerTransport,
  type CallToolResult,
  SetLevelRequestSchema,
} from './third_party/index.js';
import * as advisorTools from './tools/advisor.js';
import * as agentRunnerTools from './tools/agent-runner.js';
import * as jshookAnalyzerTools from './tools/analyzer.js';
import {ToolCategory} from './tools/categories.js';
import * as jshookCollectorTools from './tools/collector.js';
import * as consoleTools from './tools/console.js';
import * as debuggerTools from './tools/debugger.js';
import * as diagnosticsTools from './tools/diagnostics.js';
import * as jshookDomTools from './tools/dom.js';
import * as frameTools from './tools/frames.js';
import * as jshookHookTools from './tools/hook.js';
import * as networkTools from './tools/network.js';
import {optimizationTools} from './tools/optimizations.js';
import * as orchestratorTools from './tools/orchestrator.js';
import * as jshookPageTools from './tools/page.js';
import * as pagesTools from './tools/pages.js';
import {selectToolsForProfile, type ToolProfile} from './tools/profile.js';
import * as jshookRebuildTools from './tools/rebuild.js';
import {getJSHookRuntime} from './tools/runtime.js';
import * as screenshotTools from './tools/screenshot.js';
import * as scriptTools from './tools/script.js';
import * as jshookStealthTools from './tools/stealth.js';
import * as taskManagerTools from './tools/task-manager.js';
import * as taskTools from './tools/task.js';
import type {ToolDefinition} from './tools/ToolDefinition.js';
import {ToolRegistry} from './tools/ToolRegistry.js';
import {
  resolveTraceOutputMode,
  withOptionalTraceIdContent,
} from './tools/trace-output.js';
import * as websocketTools from './tools/websocket.js';
import * as workflowTools from './tools/workflows.js';
import {ErrorCodes, formatError} from './utils/errors.js';
import {TokenBudgetManager} from './utils/TokenBudgetManager.js';
import {ToolExecutionScheduler} from './utils/ToolExecutionScheduler.js';

// If moved update release-please config
// x-release-please-start-version
const VERSION = '2.0.4';
// x-release-please-end

export const args = parseArguments(VERSION);

if (await executeKnowledgeCliCommand(args)) {
  process.exit(0);
}

const logFile = args.logFile ? saveLogsToFile(args.logFile) : undefined;

logger(`Starting Chrome DevTools MCP Server v${VERSION}`);
const server = new McpServer(
  {
    name: 'chrome_devtools',
    title: 'Chrome DevTools MCP server',
    version: VERSION,
  },
  {capabilities: {logging: {}}},
);
server.server.setRequestHandler(SetLevelRequestSchema, () => {
  return {};
});

let context: McpContext;
async function getContext(): Promise<McpContext> {
  const extraArgs: string[] = (args.chromeArg ?? []).map(String);
  if (args.proxyServer) {
    extraArgs.push(`--proxy-server=${args.proxyServer}`);
  }
  const devtools = args.experimentalDevtools ?? false;
  const autoConnectTarget =
    !args.browserUrl && !args.wsEndpoint && args.autoConnect
      ? await resolveAutoConnectTarget()
      : undefined;
  const browser =
    args.browserUrl || args.wsEndpoint || autoConnectTarget
      ? await ensureBrowserConnected({
          browserURL: args.browserUrl ?? autoConnectTarget?.browserURL,
          wsEndpoint: args.wsEndpoint ?? autoConnectTarget?.wsEndpoint,
          wsHeaders: args.wsHeaders,
          devtools,
        })
      : await ensureBrowserLaunched({
          headless: args.headless,
          executablePath: args.executablePath,
          channel: args.channel as Channel,
          isolated: args.isolated,
          logFile,
          viewport: args.viewport,
          args: extraArgs,
          acceptInsecureCerts: args.acceptInsecureCerts,
          devtools,
        });

  if (context?.browser !== browser) {
    context = await McpContext.from(browser, logger, {
      experimentalDevToolsDebugging: devtools,
      experimentalIncludeAllPages: args.experimentalIncludeAllPages,
    });
  }
  return context;
}

const logDisclaimers = () => {
  console.error(
    `JSReverser-MCP exposes content of the browser instance to the MCP clients allowing them to inspect,
debug, and modify any data in the browser or DevTools.
Avoid sharing sensitive or personal information that you do not want to share with MCP clients.`,
  );
};

const toolScheduler = new ToolExecutionScheduler();
const tokenBudgetManager = TokenBudgetManager.getInstance();
const toolCanonicalSourceOverrides: Record<string, string> = {};

function createTraceId(toolName: string): string {
  return `${toolName}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function logToolEvent(
  traceId: string,
  toolName: string,
  phase: string,
  details: Record<string, unknown> = {},
): void {
  logger(
    JSON.stringify({
      type: 'tool_event',
      traceId,
      tool: toolName,
      phase,
      ...details,
    }),
  );
}

function registerTool(tool: ToolDefinition): void {
  if (
    tool.annotations.category === ToolCategory.NETWORK &&
    args.categoryNetwork === false
  ) {
    return;
  }
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: tool.annotations,
    },
    async (params): Promise<CallToolResult> => {
      // 2026-09-01：把 CLI --tool-timeout-ms 接进 ToolExecutionScheduler.withTimeout
      // （此前 execute 不传 options.timeoutMs → 永不超时，挂起的 CDP 工具可永久阻塞
      // 会话；write 互斥队列还会被后续调用全部堵死）。
      return toolScheduler.execute(
        tool.annotations.readOnlyHint,
        async () => {
        const traceId = createTraceId(tool.name);
        const startedAt = Date.now();
        try {
          logToolEvent(traceId, tool.name, 'request', {params});
          const requiresBrowser = tool.requiresBrowser ?? true;
          const context = requiresBrowser ? await getContext() : undefined;
          if (context) {
            logToolEvent(traceId, tool.name, 'context_resolved');
            await context.detectOpenDevToolsWindows();
            getJSHookRuntime().bindPageContext(() => context.getSelectedPage());
          } else {
            logToolEvent(traceId, tool.name, 'context_skipped');
          }
          const response = new McpResponse();
          await tool.handler(
            {
              params,
            },
            response,
            context as Awaited<ReturnType<typeof getContext>>,
          );
          try {
            const content = context
              ? await response.handle(tool.name, context)
              : response.handleWithoutContext(tool.name);
            const wrapped = withOptionalTraceIdContent(
              content,
              traceId,
              resolveTraceOutputMode(
                args.traceOutput,
                (params as Record<string, unknown>).traceOutput,
              ),
            );
            tokenBudgetManager.recordToolCall(tool.name, params, content);
            logToolEvent(traceId, tool.name, 'success', {
              durationMs: Date.now() - startedAt,
            });
            return {
              content: wrapped,
            };
          } catch (error) {
            const formatted = formatError(
              error,
              ErrorCodes.TOOL_EXECUTION_ERROR,
              {
                tool: tool.name,
                traceId,
              },
            );
            tokenBudgetManager.recordToolCall(tool.name, params, formatted);
            logToolEvent(traceId, tool.name, 'response_error', {
              durationMs: Date.now() - startedAt,
              error: formatted,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({traceId, ...formatted}, null, 2),
                },
              ],
              isError: true,
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logToolEvent(traceId, tool.name, 'handler_error', {
            error: message,
            durationMs: Date.now() - startedAt,
          });
          throw err;
        }
      },
        {timeoutMs: args.toolTimeoutMs || undefined},
      );
    },
  );
}

function asTools(module: object): ToolDefinition[] {
  return Object.values(module) as unknown as ToolDefinition[];
}

const toolSources: Array<{source: string; tools: ToolDefinition[]}> = [
  {source: 'console', tools: asTools(consoleTools)},
  {source: 'agentRunner', tools: asTools(agentRunnerTools)},
  {source: 'debugger', tools: asTools(debuggerTools)},
  {source: 'diagnostics', tools: asTools(diagnosticsTools)},
  {source: 'advisor', tools: asTools(advisorTools)},
  {source: 'frames', tools: asTools(frameTools)},
  {source: 'network', tools: asTools(networkTools)},
  {source: 'optimizations', tools: optimizationTools as ToolDefinition[]},
  {source: 'pages', tools: asTools(pagesTools)},
  {source: 'screenshot', tools: asTools(screenshotTools)},
  {source: 'script', tools: asTools(scriptTools)},
  {source: 'orchestrator', tools: asTools(orchestratorTools)},
  {source: 'task', tools: asTools(taskTools)},
  {source: 'taskManager', tools: asTools(taskManagerTools)},
  {source: 'jshookCollector', tools: asTools(jshookCollectorTools)},
  {source: 'jshookAnalyzer', tools: asTools(jshookAnalyzerTools)},
  {source: 'jshookHook', tools: asTools(jshookHookTools)},
  {source: 'jshookStealth', tools: asTools(jshookStealthTools)},
  {source: 'jshookDom', tools: asTools(jshookDomTools)},
  {source: 'jshookPage', tools: asTools(jshookPageTools)},
  {source: 'jshookRebuild', tools: asTools(jshookRebuildTools)},
  {source: 'websocket', tools: asTools(websocketTools)},
  {source: 'workflow', tools: asTools(workflowTools)},
];

const tools = toolSources.flatMap(entry =>
  entry.tools.map(tool => ({
    source: entry.source,
    tool,
  })),
);

function applyCanonicalSelection(
  allTools: Array<{source: string; tool: ToolDefinition}>,
): ToolDefinition[] {
  const selected = new Map<string, {source: string; tool: ToolDefinition}>();
  for (const entry of allTools) {
    const existing = selected.get(entry.tool.name);
    if (!existing) {
      selected.set(entry.tool.name, entry);
      continue;
    }

    const preferSource = toolCanonicalSourceOverrides[entry.tool.name];
    if (preferSource && entry.source === preferSource) {
      selected.set(entry.tool.name, entry);
    }
  }
  return Array.from(selected.values()).map(entry => entry.tool);
}

const registry = new ToolRegistry();
registry.registerMany(
  selectToolsForProfile(
    applyCanonicalSelection(tools),
    args.toolProfile as ToolProfile,
  ),
);

const registeredTools = registry.values();
registeredTools.sort((a, b) => {
  return a.name.localeCompare(b.name);
});

for (const tool of registeredTools) {
  const aliases = registry.aliasesFor(tool.name);
  if (aliases.length > 0) {
    tool.aliases = aliases;
  }
  registerTool(tool);
  for (const alias of aliases) {
    registerTool({
      ...tool,
      name: alias,
      aliases: [],
      description: `${tool.description} (alias of ${tool.name})`,
    });
  }
}

if (features.issues) {
  await loadIssueDescriptions();
}
const transport = new StdioServerTransport();
await server.connect(transport);
logger('Chrome DevTools MCP Server connected');
logDisclaimers();
