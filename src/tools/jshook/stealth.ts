import {zod} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
import {StealthScripts2025} from '../../modules/stealth/StealthScripts2025.js';
import {getJSHookRuntime} from './runtime.js';

export const injectStealth = defineTool({
  name: 'inject_stealth',
  description: 'Inject anti-detection stealth scripts to current page.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    preset: zod.enum(['windows-chrome', 'mac-chrome', 'mac-safari', 'linux-chrome', 'windows-edge']).optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();
    await StealthScripts2025.injectAll(page, {preset: request.params.preset});
    response.appendResponseLine('Stealth scripts injected.');
  },
});

export const listStealthPresets = defineTool({
  name: 'list_stealth_presets',
  description: 'List available stealth presets.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(StealthScripts2025.getPresets(), null, 2));
    response.appendResponseLine('```');
  },
});

export const listStealthFeatures = defineTool({
  name: 'list_stealth_features',
  description: 'List available stealth feature toggles.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify([
      'hideWebDriver', 'mockChrome', 'setUserAgent', 'fixPermissions', 'mockPlugins',
      'canvasNoise', 'webglOverride', 'audioContextNoise', 'fixLanguages', 'mockBattery',
      'mockMediaDevices', 'mockNotifications', 'mockConnection', 'focusOverride',
      'performanceNoise', 'overrideScreen',
    ], null, 2));
    response.appendResponseLine('```');
  },
});

export const setUserAgent = defineTool({
  name: 'set_user_agent',
  description: 'Set custom user-agent for active page.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {userAgent: zod.string().min(1)},
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const page = await runtime.collector.getActivePage();
    await page.setUserAgent(request.params.userAgent);
    response.appendResponseLine('User-Agent updated.');
  },
});
