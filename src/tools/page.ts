/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';
import {defineTool, type Context} from './ToolDefinition.js';

interface SessionSnapshot {
  id: string;
  savedAt: string;
  expiresAt: string;
  url: string;
  title: string;
  cookies: any[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

const sessionSnapshots = new Map<string, SessionSnapshot>();
const sessionTtlMs = Math.max(
  60_000,
  Number(process.env.SESSION_STATE_TTL_MS ?? 30 * 60_000),
);
const cleanupIntervalMs = Math.max(
  15_000,
  Number(process.env.SESSION_STATE_CLEANUP_INTERVAL_MS ?? 5 * 60_000),
);

let cleanupInitialized = false;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;
const CLICK_BREAKPOINT_SETTLE_TIMEOUT_MS = 750;

function cleanupExpiredSessions(now = Date.now()): number {
  let removed = 0;
  for (const [sessionId, snapshot] of sessionSnapshots.entries()) {
    if (Date.parse(snapshot.expiresAt) <= now) {
      sessionSnapshots.delete(sessionId);
      removed += 1;
    }
  }
  return removed;
}

function ensureCleanupLoop(): void {
  if (cleanupInitialized) {
    return;
  }
  cleanupInitialized = true;
  cleanupTimer = setInterval(() => {
    cleanupExpiredSessions();
  }, cleanupIntervalMs);
  cleanupTimer.unref?.();
}

function getEncryptionKey(): Buffer | undefined {
  const configured = process.env.SESSION_STATE_ENCRYPTION_KEY;
  if (!configured || configured.length === 0) {
    return undefined;
  }
  return createHash('sha256').update(configured).digest();
}

function encryptText(plainText: string): {
  encrypted: true;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
} {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('SESSION_STATE_ENCRYPTION_KEY is required for encryption.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: true,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptText(payload: {
  encrypted: true;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('SESSION_STATE_ENCRYPTION_KEY is required for decryption.');
  }
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const encrypted = Buffer.from(payload.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
}

function normalizeSnapshot(
  snapshot: unknown,
  fallbackId?: string,
): SessionSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid session snapshot payload: expected object.');
  }
  const raw = snapshot as Partial<SessionSnapshot>;
  const id =
    typeof raw.id === 'string' && raw.id.length > 0
      ? raw.id
      : (fallbackId ?? `session_${Date.now()}`);
  return {
    id,
    savedAt:
      typeof raw.savedAt === 'string' && raw.savedAt.length > 0
        ? raw.savedAt
        : new Date().toISOString(),
    expiresAt:
      typeof raw.expiresAt === 'string' && raw.expiresAt.length > 0
        ? raw.expiresAt
        : new Date(Date.now() + sessionTtlMs).toISOString(),
    url: typeof raw.url === 'string' ? raw.url : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    cookies: Array.isArray(raw.cookies) ? raw.cookies : [],
    localStorage:
      raw.localStorage && typeof raw.localStorage === 'object'
        ? raw.localStorage
        : {},
    sessionStorage:
      raw.sessionStorage && typeof raw.sessionStorage === 'object'
        ? raw.sessionStorage
        : {},
  };
}

async function withRuntimePageContext<T>(
  context: Context,
  pageIdx: number | undefined,
  action: () => Promise<T>,
): Promise<T> {
  if (pageIdx === undefined) {
    return action();
  }
  if (
    typeof context.getPageByOptionalIdx !== 'function' ||
    typeof context.getSelectedPage !== 'function'
  ) {
    return action();
  }
  const runtime = getJSHookRuntime();
  const targetPage = context.getPageByOptionalIdx(pageIdx);
  runtime.syncPageContext(targetPage);
  try {
    return await action();
  } finally {
    runtime.syncPageContext(context.getSelectedPage());
    runtime.bindPageContext(() => context.getSelectedPage());
  }
}

async function clickWithPauseAwareness(
  context: Context,
  clickPromise: Promise<void>,
): Promise<'clicked' | 'paused' | 'dispatched'> {
  // 避免“点击后立即命中断点”时 page.click() 永久挂住整个 MCP 调用。
  void clickPromise.catch(() => undefined);

  if (!context.debuggerContext?.isEnabled?.()) {
    await clickPromise;
    return 'clicked';
  }

  const firstOutcome = await Promise.race([
    clickPromise.then(() => 'clicked' as const),
    context.debuggerContext
      .waitForPause(CLICK_BREAKPOINT_SETTLE_TIMEOUT_MS)
      .then(() => 'paused' as const)
      .catch(() => 'timeout' as const),
  ]);

  if (firstOutcome === 'paused') {
    return 'paused';
  }

  if (firstOutcome === 'clicked') {
    return 'clicked';
  }

  return 'dispatched';
}

async function createPageClickPromise(
  context: Context,
  pageIdx: number | undefined,
  selector: string,
): Promise<void> {
  const runtime = getJSHookRuntime();
  const page = (await (typeof context.getPageByOptionalIdx === 'function'
    ? Promise.resolve(context.getPageByOptionalIdx(pageIdx))
    : typeof context.getSelectedPage === 'function'
      ? Promise.resolve(context.getSelectedPage())
      : runtime.collector.getActivePage())) as Context['getSelectedPage'] extends () => infer T
    ? T
    : never;
  if (typeof (page as {evaluate?: unknown}).evaluate === 'function') {
    return (
      page as {
        evaluate: <T>(
          fn: (selector: string) => T,
          selector: string,
        ) => Promise<T>;
      }
    ).evaluate((targetSelector: string) => {
      const element = document.querySelector(targetSelector);
      if (!element) {
        throw new Error(`No element found for selector: ${targetSelector}`);
      }
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Target is not an HTMLElement: ${targetSelector}`);
      }
      element.click();
    }, selector);
  }

  if (typeof (page as {click?: unknown}).click === 'function') {
    return (page as {click(selector: string): Promise<void>}).click(selector);
  }

  return runtime.pageController.click(selector);
}

export const clickElement = defineTool({
  name: 'click_element',
  description: 'Click an element by selector.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    selector: zod.string(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const outcome = await clickWithPauseAwareness(
      context,
      createPageClickPromise(
        context,
        request.params.pageIdx,
        request.params.selector,
      ),
    );
    response.appendResponseLine(
      outcome === 'paused'
        ? 'Element clicked. Execution paused at breakpoint.'
        : outcome === 'dispatched'
          ? 'Element click dispatched while debugger is active. If execution paused, run get_paused_info / step_over / resume next.'
          : 'Element clicked.',
    );
  },
});

export const typeText = defineTool({
  name: 'type_text',
  description: 'Type text into an input element.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    selector: zod.string(),
    text: zod.string(),
    delay: zod.number().int().nonnegative().optional(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.type(
        request.params.selector,
        request.params.text,
        {
          delay: request.params.delay,
        },
      ),
    );
    response.appendResponseLine('Text typed.');
  },
});

export const hoverElement = defineTool({
  name: 'hover_element',
  description: 'Hover over an element by selector.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    selector: zod.string(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.hover(request.params.selector),
    );
    response.appendResponseLine('Element hovered.');
  },
});

export const selectOption = defineTool({
  name: 'select_option',
  description: 'Select one or more values in a native select element.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    selector: zod.string(),
    values: zod.array(zod.string()).min(1),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.select(
        request.params.selector,
        ...request.params.values,
      ),
    );
    response.appendResponseLine('Option selected.');
  },
});

export const scrollPage = defineTool({
  name: 'scroll_page',
  description: 'Scroll the page to absolute x/y coordinates.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    x: zod.number().optional(),
    y: zod.number().optional(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.scroll({
        x: request.params.x,
        y: request.params.y,
      }),
    );
    response.appendResponseLine('Page scrolled.');
  },
});

export const pressKey = defineTool({
  name: 'press_key',
  description: 'Press a keyboard key on the active page.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    key: zod.string(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.pressKey(request.params.key),
    );
    response.appendResponseLine('Key pressed.');
  },
});

export const uploadFile = defineTool({
  name: 'upload_file',
  description: 'Upload a local file through a file input selector.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    selector: zod.string(),
    filePath: zod.string(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.uploadFile(
        request.params.selector,
        request.params.filePath,
      ),
    );
    response.appendResponseLine('File uploaded.');
  },
});

export const waitForElement = defineTool({
  name: 'wait_for_element',
  description: 'Wait for selector to appear.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    selector: zod.string(),
    timeout: zod.number().int().positive().optional(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const result = await withRuntimePageContext(
      context,
      request.params.pageIdx,
      () =>
        runtime.pageController.waitForSelector(
          request.params.selector,
          request.params.timeout,
        ),
    );
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const waitForNetworkIdle = defineTool({
  name: 'wait_for_network_idle',
  description: 'Wait until the page network becomes idle.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    timeout: zod.number().int().positive().optional(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.waitForNetworkIdle(request.params.timeout),
    );
    response.appendResponseLine('Network is idle.');
  },
});

export const getPerformanceMetrics = defineTool({
  name: 'get_performance_metrics',
  description: 'Get page performance metrics from Performance API.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const metrics = await withRuntimePageContext(
      context,
      request.params.pageIdx,
      () => runtime.pageController.getPerformanceMetrics(),
    );
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(metrics, null, 2));
    response.appendResponseLine('```');
  },
});

export const setViewport = defineTool({
  name: 'set_viewport',
  description: 'Set the active page viewport size.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    width: zod.number().int().positive(),
    height: zod.number().int().positive(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.setViewport(
        request.params.width,
        request.params.height,
      ),
    );
    response.appendResponseLine('Viewport updated.');
  },
});

export const emulateDevice = defineTool({
  name: 'emulate_device',
  description: 'Emulate a common mobile device profile.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
    deviceName: zod.enum(['iPhone', 'iPad', 'Android']),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await withRuntimePageContext(context, request.params.pageIdx, () =>
      runtime.pageController.emulateDevice(request.params.deviceName),
    );
    response.appendResponseLine('Device emulation updated.');
  },
});

export const getAllLinks = defineTool({
  name: 'get_all_links',
  description: 'List links on the active page.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const links = await withRuntimePageContext(
      context,
      request.params.pageIdx,
      () => runtime.pageController.getAllLinks(),
    );
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(links, null, 2));
    response.appendResponseLine('```');
  },
});

async function handleSessionStateSave(
  request: {params: Record<string, any>},
  response: any,
  context: Context,
): Promise<void> {
  const runtime = getJSHookRuntime();
  const sessionId = request.params.sessionId ?? `session_${Date.now()}`;
  const includeCookies = request.params.includeCookies !== false;
  const includeLocalStorage = request.params.includeLocalStorage !== false;
  const includeSessionStorage = request.params.includeSessionStorage !== false;

  const snapshot = await withRuntimePageContext(
    context,
    request.params.pageIdx,
    async (): Promise<SessionSnapshot> => {
      const page = await runtime.pageController.getPage();
      return {
        id: sessionId,
        savedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
        url: page.url(),
        title: await page.title(),
        cookies: includeCookies
          ? await runtime.pageController.getCookies()
          : [],
        localStorage: includeLocalStorage
          ? await runtime.pageController.getLocalStorage()
          : {},
        sessionStorage: includeSessionStorage
          ? await runtime.pageController.getSessionStorage()
          : {},
      };
    },
  );
  sessionSnapshots.set(sessionId, snapshot);

  response.appendResponseLine('```json');
  response.appendResponseLine(
    JSON.stringify(
      {
        action: 'save',
        sessionId,
        savedAt: snapshot.savedAt,
        url: snapshot.url,
        title: snapshot.title,
        counts: {
          cookies: snapshot.cookies.length,
          localStorage: Object.keys(snapshot.localStorage).length,
          sessionStorage: Object.keys(snapshot.sessionStorage).length,
        },
      },
      null,
      2,
    ),
  );
  response.appendResponseLine('```');
}

async function handleSessionStateRestore(
  request: {params: Record<string, any>},
  response: any,
  context: Context,
): Promise<void> {
  const runtime = getJSHookRuntime();
  if (!request.params.sessionId) {
    throw new Error('sessionId is required for action=restore.');
  }
  const snapshot = sessionSnapshots.get(request.params.sessionId);
  if (!snapshot) {
    throw new Error(`Session snapshot not found: ${request.params.sessionId}`);
  }

  await withRuntimePageContext(context, request.params.pageIdx, async () => {
    if (request.params.navigateToSavedUrl !== false) {
      await runtime.pageController.navigate(snapshot.url);
    }
    if (request.params.clearStorageBeforeRestore === true) {
      await runtime.pageController.clearLocalStorage();
      await runtime.pageController.clearSessionStorage();
      await runtime.pageController.clearCookies();
    }
    if (snapshot.cookies.length > 0) {
      await runtime.pageController.setCookies(snapshot.cookies);
    }
    for (const [key, value] of Object.entries(snapshot.localStorage)) {
      await runtime.pageController.setLocalStorage(key, value);
    }
    for (const [key, value] of Object.entries(snapshot.sessionStorage)) {
      await runtime.pageController.setSessionStorage(key, value);
    }
  });

  response.appendResponseLine('```json');
  response.appendResponseLine(
    JSON.stringify(
      {
        action: 'restore',
        sessionId: snapshot.id,
        restoredAt: new Date().toISOString(),
        url: snapshot.url,
        restored: {
          cookies: snapshot.cookies.length,
          localStorage: Object.keys(snapshot.localStorage).length,
          sessionStorage: Object.keys(snapshot.sessionStorage).length,
        },
      },
      null,
      2,
    ),
  );
  response.appendResponseLine('```');
}

function handleSessionStateList(response: any): void {
  const removed = cleanupExpiredSessions();
  const sessions = Array.from(sessionSnapshots.values()).map(snapshot => ({
    sessionId: snapshot.id,
    savedAt: snapshot.savedAt,
    url: snapshot.url,
    title: snapshot.title,
    counts: {
      cookies: snapshot.cookies.length,
      localStorage: Object.keys(snapshot.localStorage).length,
      sessionStorage: Object.keys(snapshot.sessionStorage).length,
    },
    expiresAt: snapshot.expiresAt,
  }));

  response.appendResponseLine('```json');
  response.appendResponseLine(
    JSON.stringify(
      {
        action: 'list',
        total: sessions.length,
        cleanedExpired: removed,
        sessions,
      },
      null,
      2,
    ),
  );
  response.appendResponseLine('```');
}

function handleSessionStateDelete(
  request: {params: Record<string, any>},
  response: any,
): void {
  if (!request.params.sessionId) {
    throw new Error('sessionId is required for action=delete.');
  }
  const deleted = sessionSnapshots.delete(request.params.sessionId);
  response.appendResponseLine('```json');
  response.appendResponseLine(
    JSON.stringify(
      {
        action: 'delete',
        sessionId: request.params.sessionId,
        deleted,
        remaining: sessionSnapshots.size,
      },
      null,
      2,
    ),
  );
  response.appendResponseLine('```');
}

async function handleSessionStateDump(
  request: {params: Record<string, any>},
  response: any,
): Promise<void> {
  if (!request.params.sessionId) {
    throw new Error('sessionId is required for action=dump.');
  }
  const snapshot = sessionSnapshots.get(request.params.sessionId);
  if (!snapshot) {
    throw new Error(`Session snapshot not found: ${request.params.sessionId}`);
  }

  const pretty = request.params.pretty !== false;
  const rawJson = JSON.stringify(snapshot, null, pretty ? 2 : 0);
  const encryptedPayload =
    request.params.encrypt === true ? encryptText(rawJson) : null;
  const json = encryptedPayload
    ? JSON.stringify(encryptedPayload, null, pretty ? 2 : 0)
    : rawJson;
  if (request.params.path) {
    await writeFile(request.params.path, json, 'utf8');
  }

  response.appendResponseLine('```json');
  response.appendResponseLine(
    JSON.stringify(
      {
        action: 'dump',
        sessionId: snapshot.id,
        path: request.params.path ?? null,
        bytes: Buffer.byteLength(json, 'utf8'),
        encrypted: request.params.encrypt === true,
        snapshot,
      },
      null,
      2,
    ),
  );
  response.appendResponseLine('```');
}

async function handleSessionStateLoad(
  request: {params: Record<string, any>},
  response: any,
): Promise<void> {
  const rawJson = request.params.path
    ? await readFile(request.params.path, 'utf8')
    : request.params.snapshotJson;
  if (!rawJson) {
    throw new Error(
      'Either path or snapshotJson must be provided for action=load.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid snapshot JSON content.');
  }
  const normalizedRaw =
    parsed &&
    typeof parsed === 'object' &&
    (parsed as any).encrypted === true &&
    (parsed as any).algorithm === 'aes-256-gcm'
      ? JSON.parse(decryptText(parsed as any))
      : parsed;
  const snapshot = normalizeSnapshot(normalizedRaw, request.params.sessionId);
  const targetId = request.params.sessionId ?? snapshot.id;
  const existing = sessionSnapshots.has(targetId);
  if (existing && request.params.overwrite !== true) {
    throw new Error(
      `Session snapshot already exists: ${targetId}. Set overwrite=true to replace.`,
    );
  }

  const normalized = normalizeSnapshot({...snapshot, id: targetId}, targetId);
  sessionSnapshots.set(targetId, normalized);

  response.appendResponseLine('```json');
  response.appendResponseLine(
    JSON.stringify(
      {
        action: 'load',
        sessionId: targetId,
        loaded: true,
        overwritten: existing,
        counts: {
          cookies: normalized.cookies.length,
          localStorage: Object.keys(normalized.localStorage).length,
          sessionStorage: Object.keys(normalized.sessionStorage).length,
        },
      },
      null,
      2,
    ),
  );
  response.appendResponseLine('```');
}

export const sessionState = defineTool({
  name: 'session_state',
  description:
    'Manage in-memory session snapshots: save, restore, list, delete, dump, or load.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    action: zod.enum(['save', 'restore', 'list', 'delete', 'dump', 'load']),
    pageIdx: zod.number().int().min(0).optional(),
    sessionId: zod.string().optional(),
    includeCookies: zod.boolean().optional(),
    includeLocalStorage: zod.boolean().optional(),
    includeSessionStorage: zod.boolean().optional(),
    navigateToSavedUrl: zod.boolean().optional(),
    clearStorageBeforeRestore: zod.boolean().optional(),
    path: zod.string().optional(),
    pretty: zod.boolean().optional(),
    encrypt: zod.boolean().optional(),
    snapshotJson: zod.string().optional(),
    overwrite: zod.boolean().optional(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();

    switch (request.params.action) {
      case 'save':
        await handleSessionStateSave(request, response, context);
        return;
      case 'restore':
        await handleSessionStateRestore(request, response, context);
        return;
      case 'list':
        handleSessionStateList(response);
        return;
      case 'delete':
        handleSessionStateDelete(request, response);
        return;
      case 'dump':
        await handleSessionStateDump(request, response);
        return;
      case 'load':
        await handleSessionStateLoad(request, response);
        return;
    }
  },
});

export const checkBrowserHealth = defineTool({
  name: 'check_browser_health',
  description:
    'Check browser connectivity and active page readiness before running reverse workflows.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    pageIdx: zod.number().int().min(0).optional(),
  },
  handler: async (request, response, context) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const issues: Array<{code: string; message: string}> = [];
    const browser = runtime.browserManager?.getConnectedBrowser();
    let connected = Boolean(browser && browser.isConnected());
    try {
      const status = await runtime.collector.getStatus();
      connected = connected || status.running;
    } catch {
      // Fall through to page-level probes below.
    }

    let pageReady = false;
    let url: string | null = null;
    let title: string | null = null;
    try {
      await withRuntimePageContext(
        context,
        request.params.pageIdx,
        async () => {
          const page = await runtime.pageController.getPage();
          pageReady = true;
          connected = true;
          url = page.url();
          title = await page.title();
          await runtime.pageController.evaluate('1+1');
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        code: 'NO_ACTIVE_PAGE',
        message: `No controllable active page: ${message}`,
      });
    }

    if (!connected) {
      issues.push({
        code: 'BROWSER_DISCONNECTED',
        message:
          'Browser is not connected. Use browserUrl/wsEndpoint or start remote debugging.',
      });
    }

    const status = !connected ? 'fail' : issues.length > 0 ? 'warn' : 'ok';

    const result = {
      status,
      healthy: issues.length === 0,
      connected,
      pageReady,
      currentPage: {url, title},
      recommendations: [
        !connected
          ? 'Start Chrome with --remote-debugging-port and reconnect MCP.'
          : null,
        connected && !pageReady
          ? 'Open/select a target page, then retry health check.'
          : null,
      ].filter((item): item is string => Boolean(item)),
      issues,
    };

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});
