/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './polyfill.js';

import type {Channel} from './browser.js';
import {ensureBrowserConnected, ensureBrowserLaunched} from './browser.js';
import {parseArguments} from './cli.js';
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
import {ToolCategory} from './tools/categories.js';
import * as consoleTools from './tools/console.js';
import * as debuggerTools from './tools/debugger.js';
import * as networkTools from './tools/network.js';
import * as pagesTools from './tools/pages.js';
import * as screenshotTools from './tools/screenshot.js';
import * as scriptTools from './tools/script.js';
import {ToolRegistry} from './tools/ToolRegistry.js';
import type {ToolDefinition} from './tools/ToolDefinition.js';
import * as jshookCollectorTools from './tools/jshook/collector.js';
import * as jshookAnalyzerTools from './tools/jshook/analyzer.js';
import * as jshookHookTools from './tools/jshook/hook.js';
import * as jshookStealthTools from './tools/jshook/stealth.js';
import * as jshookDomTools from './tools/jshook/dom.js';
import * as jshookPageTools from './tools/jshook/page.js';
import * as websocketTools from './tools/websocket.js';
import {ErrorCodes, formatError} from './utils/errors.js';
import {TokenBudgetManager} from './utils/TokenBudgetManager.js';
import {ToolExecutionScheduler} from './utils/ToolExecutionScheduler.js';

// If moved update release-please config
// x-release-please-start-version
const VERSION = '0.10.2';
// x-release-please-end

export const args = parseArguments(VERSION);

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
  const browser =
    args.browserUrl || args.wsEndpoint
      ? await ensureBrowserConnected({
          browserURL: args.browserUrl,
          wsEndpoint: args.wsEndpoint,
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
    `chrome-devtools-mcp exposes content of the browser instance to the MCP clients allowing them to inspect,
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

function withTraceIdContent(content: CallToolResult['content'], traceId: string): CallToolResult['content'] {
  return [
    {
      type: 'text',
      text: JSON.stringify({traceId}, null, 2),
    },
    ...content,
  ];
}

function logToolEvent(traceId: string, toolName: string, phase: string, details: Record<string, unknown> = {}): void {
  logger(JSON.stringify({
    type: 'tool_event',
    traceId,
    tool: toolName,
    phase,
    ...details,
  }));
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
      return toolScheduler.execute(tool.annotations.readOnlyHint, async () => {
        const traceId = createTraceId(tool.name);
        const startedAt = Date.now();
        try {
          logToolEvent(traceId, tool.name, 'request', {params});
          const context = await getContext();
          logToolEvent(traceId, tool.name, 'context_resolved');
          await context.detectOpenDevToolsWindows();
          const response = new McpResponse();
          await tool.handler(
            {
              params,
            },
            response,
            context,
          );
          try {
            const content = await response.handle(tool.name, context);
            const wrapped = withTraceIdContent(content, traceId);
            tokenBudgetManager.recordToolCall(tool.name, params, content);
            logToolEvent(traceId, tool.name, 'success', {durationMs: Date.now() - startedAt});
            return {
              content: wrapped,
            };
          } catch (error) {
            const formatted = formatError(error, ErrorCodes.TOOL_EXECUTION_ERROR, {
              tool: tool.name,
              traceId,
            });
            tokenBudgetManager.recordToolCall(tool.name, params, formatted);
            logToolEvent(traceId, tool.name, 'response_error', {durationMs: Date.now() - startedAt, error: formatted});

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
          logToolEvent(traceId, tool.name, 'handler_error', {error: message, durationMs: Date.now() - startedAt});
          throw err;
        }
      });
    },
  );
}

function asTools(module: object): ToolDefinition[] {
  return Object.values(module) as unknown as ToolDefinition[];
}

const toolSources: Array<{source: string; tools: ToolDefinition[]}> = [
  {source: 'console', tools: asTools(consoleTools)},
  {source: 'debugger', tools: asTools(debuggerTools)},
  {source: 'network', tools: asTools(networkTools)},
  {source: 'pages', tools: asTools(pagesTools)},
  {source: 'screenshot', tools: asTools(screenshotTools)},
  {source: 'script', tools: asTools(scriptTools)},
  {source: 'jshookCollector', tools: asTools(jshookCollectorTools)},
  {source: 'jshookAnalyzer', tools: asTools(jshookAnalyzerTools)},
  {source: 'jshookHook', tools: asTools(jshookHookTools)},
  {source: 'jshookStealth', tools: asTools(jshookStealthTools)},
  {source: 'jshookDom', tools: asTools(jshookDomTools)},
  {source: 'jshookPage', tools: asTools(jshookPageTools)},
  {source: 'websocket', tools: asTools(websocketTools)},
];

const tools = toolSources.flatMap((entry) =>
  entry.tools.map((tool) => ({
    source: entry.source,
    tool,
  })),
);

function applyCanonicalSelection(allTools: Array<{source: string; tool: ToolDefinition}>): ToolDefinition[] {
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
  return Array.from(selected.values()).map((entry) => entry.tool);
}

const registry = new ToolRegistry();
registry.registerMany(applyCanonicalSelection(tools));

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
