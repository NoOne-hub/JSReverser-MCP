/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

import {cliOptions} from '../build/src/cli.js';
import {ToolCategory, labels} from '../build/src/tools/categories.js';
import * as consoleTools from '../build/src/tools/console.js';
import * as debuggerTools from '../build/src/tools/debugger.js';
import * as networkTools from '../build/src/tools/network.js';
import * as pagesTools from '../build/src/tools/pages.js';
import * as screenshotTools from '../build/src/tools/screenshot.js';
import * as scriptTools from '../build/src/tools/script.js';
import * as websocketTools from '../build/src/tools/websocket.js';
import * as jshookCollectorTools from '../build/src/tools/jshook/collector.js';
import * as jshookAnalyzerTools from '../build/src/tools/jshook/analyzer.js';
import * as jshookHookTools from '../build/src/tools/jshook/hook.js';
import * as jshookStealthTools from '../build/src/tools/jshook/stealth.js';
import * as jshookDomTools from '../build/src/tools/jshook/dom.js';
import * as jshookPageTools from '../build/src/tools/jshook/page.js';

const OUTPUT_PATH = './docs/tool-reference.md';
const README_PATH = './README.md';

type ToolDef = {
  name: string;
  description: string;
  annotations: {category: ToolCategory};
  schema: Record<string, unknown>;
};

function allTools(): ToolDef[] {
  return [
    ...Object.values(consoleTools),
    ...Object.values(debuggerTools),
    ...Object.values(networkTools),
    ...Object.values(pagesTools),
    ...Object.values(screenshotTools),
    ...Object.values(scriptTools),
    ...Object.values(websocketTools),
    ...Object.values(jshookCollectorTools),
    ...Object.values(jshookAnalyzerTools),
    ...Object.values(jshookHookTools),
    ...Object.values(jshookStealthTools),
    ...Object.values(jshookDomTools),
    ...Object.values(jshookPageTools),
  ] as ToolDef[];
}

function uniqueToolsByName(tools: ToolDef[]): ToolDef[] {
  const seen = new Set<string>();
  const deduped: ToolDef[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      continue;
    }
    seen.add(tool.name);
    deduped.push(tool);
  }
  return deduped;
}

function generateConfigOptionsMarkdown(): string {
  let markdown = '';
  for (const [optionName, optionConfig] of Object.entries(cliOptions)) {
    if (optionConfig.hidden) continue;
    const aliasText = optionConfig.alias ? `, \`-${optionConfig.alias}\`` : '';
    const description = optionConfig.description || optionConfig.describe || '';

    markdown += `- **\`--${optionName}\`${aliasText}**\n`;
    markdown += `  ${description}\n`;
    markdown += `  - **Type:** ${optionConfig.type}\n`;
    if (optionConfig.choices) {
      markdown += `  - **Choices:** ${optionConfig.choices.map(c => `\`${c}\``).join(', ')}\n`;
    }
    if (optionConfig.default !== undefined) {
      markdown += `  - **Default:** \`${optionConfig.default}\`\n`;
    }
    markdown += '\n';
  }

  return markdown.trim();
}

function updateReadmeBlock(beginMarker: string, endMarker: string, content: string): void {
  const readmeContent = fs.readFileSync(README_PATH, 'utf8');
  const beginIndex = readmeContent.indexOf(beginMarker);
  const endIndex = readmeContent.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1) {
    return;
  }

  const before = readmeContent.substring(0, beginIndex + beginMarker.length);
  const after = readmeContent.substring(endIndex);
  const updated = `${before}\n\n${content}\n\n${after}`;
  fs.writeFileSync(README_PATH, updated);
}

function generateDocs(): void {
  const tools = uniqueToolsByName(allTools()).sort((a, b) => a.name.localeCompare(b.name));
  const categories = new Map<string, ToolDef[]>();

  for (const tool of tools) {
    const category = tool.annotations.category;
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category)!.push(tool);
  }

  const categoryOrder = Object.values(ToolCategory);
  let markdown = `<!-- AUTO GENERATED DO NOT EDIT - run 'npm run docs' to update-->\n\n# Chrome DevTools MCP Tool Reference\n\n> 快速按逆向目标查工具，请先看：[\`docs/reverse-task-index.md\`](./reverse-task-index.md)\n\n`;

  for (const category of categoryOrder) {
    const toolsInCategory = categories.get(category) || [];
    if (toolsInCategory.length === 0) continue;
    markdown += `- **[${labels[category]}](#${labels[category].toLowerCase().replace(/\s+/g, '-')})** (${toolsInCategory.length} tools)\n`;
    for (const tool of toolsInCategory) {
      markdown += `  - [\`${tool.name}\`](#${tool.name.toLowerCase()})\n`;
    }
  }

  markdown += '\n';

  for (const category of categoryOrder) {
    const toolsInCategory = categories.get(category) || [];
    if (toolsInCategory.length === 0) continue;

    markdown += `## ${labels[category]}\n\n`;
    for (const tool of toolsInCategory) {
      markdown += `### \`${tool.name}\`\n\n`;
      markdown += `**Description:** ${tool.description}\n\n`;

      const params = Object.keys(tool.schema || {});
      if (params.length > 0) {
        markdown += '**Parameters:**\n\n';
        for (const p of params) {
          markdown += `- \`${p}\`\n`;
        }
        markdown += '\n';
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, markdown);

  const toolsTOC = Array.from(categories.entries())
    .map(([category, categoryTools]) => {
      const lines = [`- **${labels[category as ToolCategory]}** (${categoryTools.length} tools)`];
      for (const tool of categoryTools) {
        lines.push(`  - [\`${tool.name}\`](docs/tool-reference.md#${tool.name.toLowerCase()})`);
      }
      return lines.join('\n');
    })
    .join('\n');

  updateReadmeBlock('<!-- BEGIN AUTO GENERATED TOOLS -->', '<!-- END AUTO GENERATED TOOLS -->', toolsTOC);
  updateReadmeBlock(
    '<!-- BEGIN AUTO GENERATED OPTIONS -->',
    '<!-- END AUTO GENERATED OPTIONS -->',
    generateConfigOptionsMarkdown(),
  );

  console.log(`Generated ${OUTPUT_PATH} with ${tools.length} tools.`);
}

generateDocs();
