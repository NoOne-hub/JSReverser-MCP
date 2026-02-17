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
        try {
          logger(`${tool.name} request: ${JSON.stringify(params, null, '  ')}`);
          const context = await getContext();
          logger(`${tool.name} context: resolved`);
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
            tokenBudgetManager.recordToolCall(tool.name, params, content);
            return {
              content,
            };
          } catch (error) {
            const formatted = formatError(error, ErrorCodes.TOOL_EXECUTION_ERROR, {
              tool: tool.name,
            });
            tokenBudgetManager.recordToolCall(tool.name, params, formatted);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(formatted, null, 2),
                },
              ],
              isError: true,
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger(`${tool.name} error: ${message}`);
          throw err;
        }
      });
    },
  );
}

const tools = [
  ...Object.values(consoleTools),
  ...Object.values(debuggerTools),
  ...Object.values(networkTools),
  ...Object.values(pagesTools),
  ...Object.values(screenshotTools),
  ...Object.values(scriptTools),
  ...Object.values(jshookCollectorTools),
  ...Object.values(jshookAnalyzerTools),
  ...Object.values(jshookHookTools),
  ...Object.values(jshookStealthTools),
  ...Object.values(jshookDomTools),
  ...Object.values(jshookPageTools),
  ...Object.values(websocketTools),
] as ToolDefinition[];

const registry = new ToolRegistry();
registry.registerMany(tools);

const registeredTools = registry.values();
registeredTools.sort((a, b) => {
  return a.name.localeCompare(b.name);
});

for (const tool of registeredTools) {
  registerTool(tool);
}

if (features.issues) {
  await loadIssueDescriptions();
}
const transport = new StdioServerTransport();
await server.connect(transport);
logger('Chrome DevTools MCP Server connected');
logDisclaimers();
