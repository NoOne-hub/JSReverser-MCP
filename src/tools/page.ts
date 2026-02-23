import {zod} from '../third_party/index.js';
import {defineTool} from './ToolDefinition.js';
import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';
import {readFile, writeFile} from 'node:fs/promises';
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';

type SessionSnapshot = {
  id: string;
  savedAt: string;
  expiresAt: string;
  url: string;
  title: string;
  cookies: any[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
};

const sessionSnapshots = new Map<string, SessionSnapshot>();
const sessionTtlMs = Math.max(60_000, Number(process.env.SESSION_STATE_TTL_MS ?? 30 * 60_000));
const cleanupIntervalMs = Math.max(15_000, Number(process.env.SESSION_STATE_CLEANUP_INTERVAL_MS ?? 5 * 60_000));

let cleanupInitialized = false;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

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
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
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
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function normalizeSnapshot(snapshot: unknown, fallbackId?: string): SessionSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid session snapshot payload: expected object.');
  }
  const raw = snapshot as Partial<SessionSnapshot>;
  const id = typeof raw.id === 'string' && raw.id.length > 0
    ? raw.id
    : (fallbackId ?? `session_${Date.now()}`);
  return {
    id,
    savedAt: typeof raw.savedAt === 'string' && raw.savedAt.length > 0 ? raw.savedAt : new Date().toISOString(),
    expiresAt: typeof raw.expiresAt === 'string' && raw.expiresAt.length > 0
      ? raw.expiresAt
      : new Date(Date.now() + sessionTtlMs).toISOString(),
    url: typeof raw.url === 'string' ? raw.url : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    cookies: Array.isArray(raw.cookies) ? raw.cookies : [],
    localStorage: raw.localStorage && typeof raw.localStorage === 'object' ? raw.localStorage : {},
    sessionStorage: raw.sessionStorage && typeof raw.sessionStorage === 'object' ? raw.sessionStorage : {},
  };
}

export const clickElement = defineTool({
  name: 'click_element',
  description: 'Click an element by selector.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {selector: zod.string()},
  handler: async (request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await runtime.pageController.click(request.params.selector);
    response.appendResponseLine('Element clicked.');
  },
});

export const typeText = defineTool({
  name: 'type_text',
  description: 'Type text into an input element.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    selector: zod.string(),
    text: zod.string(),
    delay: zod.number().int().nonnegative().optional(),
  },
  handler: async (request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    await runtime.pageController.type(request.params.selector, request.params.text, {
      delay: request.params.delay,
    });
    response.appendResponseLine('Text typed.');
  },
});

export const waitForElement = defineTool({
  name: 'wait_for_element',
  description: 'Wait for selector to appear.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    selector: zod.string(),
    timeout: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const result = await runtime.pageController.waitForSelector(request.params.selector, request.params.timeout);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const getPerformanceMetrics = defineTool({
  name: 'get_performance_metrics',
  description: 'Get page performance metrics from Performance API.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const metrics = await runtime.pageController.getPerformanceMetrics();
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(metrics, null, 2));
    response.appendResponseLine('```');
  },
});

export const saveSessionState = defineTool({
  name: 'save_session_state',
  description: 'Save current page session state (cookies/localStorage/sessionStorage) into in-memory snapshot.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    sessionId: zod.string().optional(),
    includeCookies: zod.boolean().optional(),
    includeLocalStorage: zod.boolean().optional(),
    includeSessionStorage: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const page = await runtime.pageController.getPage();
    const sessionId = request.params.sessionId ?? `session_${Date.now()}`;
    const includeCookies = request.params.includeCookies !== false;
    const includeLocalStorage = request.params.includeLocalStorage !== false;
    const includeSessionStorage = request.params.includeSessionStorage !== false;

    const snapshot: SessionSnapshot = {
      id: sessionId,
      savedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
      url: page.url(),
      title: await page.title(),
      cookies: includeCookies ? await runtime.pageController.getCookies() : [],
      localStorage: includeLocalStorage ? await runtime.pageController.getLocalStorage() : {},
      sessionStorage: includeSessionStorage ? await runtime.pageController.getSessionStorage() : {},
    };
    sessionSnapshots.set(sessionId, snapshot);

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      sessionId,
      savedAt: snapshot.savedAt,
      url: snapshot.url,
      title: snapshot.title,
      counts: {
        cookies: snapshot.cookies.length,
        localStorage: Object.keys(snapshot.localStorage).length,
        sessionStorage: Object.keys(snapshot.sessionStorage).length,
      },
    }, null, 2));
    response.appendResponseLine('```');
  },
});

export const restoreSessionState = defineTool({
  name: 'restore_session_state',
  description: 'Restore a previously saved session snapshot to current page.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    sessionId: zod.string(),
    navigateToSavedUrl: zod.boolean().optional(),
    clearStorageBeforeRestore: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const snapshot = sessionSnapshots.get(request.params.sessionId);
    if (!snapshot) {
      throw new Error(`Session snapshot not found: ${request.params.sessionId}`);
    }

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

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      sessionId: snapshot.id,
      restoredAt: new Date().toISOString(),
      url: snapshot.url,
      restored: {
        cookies: snapshot.cookies.length,
        localStorage: Object.keys(snapshot.localStorage).length,
        sessionStorage: Object.keys(snapshot.sessionStorage).length,
      },
    }, null, 2));
    response.appendResponseLine('```');
  },
});

export const listSessionStates = defineTool({
  name: 'list_session_states',
  description: 'List all saved session snapshots in memory.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    ensureCleanupLoop();
    const removed = cleanupExpiredSessions();
    const sessions = Array.from(sessionSnapshots.values()).map((snapshot) => ({
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
    response.appendResponseLine(JSON.stringify({total: sessions.length, cleanedExpired: removed, sessions}, null, 2));
    response.appendResponseLine('```');
  },
});

export const deleteSessionState = defineTool({
  name: 'delete_session_state',
  description: 'Delete one in-memory session snapshot by sessionId.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    sessionId: zod.string(),
  },
  handler: async (request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const deleted = sessionSnapshots.delete(request.params.sessionId);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      sessionId: request.params.sessionId,
      deleted,
      remaining: sessionSnapshots.size,
    }, null, 2));
    response.appendResponseLine('```');
  },
});

export const dumpSessionState = defineTool({
  name: 'dump_session_state',
  description: 'Export a saved session snapshot as JSON, optionally writing to a file.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    sessionId: zod.string(),
    path: zod.string().optional(),
    pretty: zod.boolean().optional(),
    encrypt: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const snapshot = sessionSnapshots.get(request.params.sessionId);
    if (!snapshot) {
      throw new Error(`Session snapshot not found: ${request.params.sessionId}`);
    }

    const pretty = request.params.pretty !== false;
    const rawJson = JSON.stringify(snapshot, null, pretty ? 2 : 0);
    const encryptedPayload = request.params.encrypt === true ? encryptText(rawJson) : null;
    const json = encryptedPayload
      ? JSON.stringify(encryptedPayload, null, pretty ? 2 : 0)
      : rawJson;
    if (request.params.path) {
      await writeFile(request.params.path, json, 'utf8');
    }

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      sessionId: snapshot.id,
      path: request.params.path ?? null,
      bytes: Buffer.byteLength(json, 'utf8'),
      encrypted: request.params.encrypt === true,
      snapshot,
    }, null, 2));
    response.appendResponseLine('```');
  },
});

export const loadSessionState = defineTool({
  name: 'load_session_state',
  description: 'Load a session snapshot from JSON string or file into memory.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    sessionId: zod.string().optional(),
    path: zod.string().optional(),
    snapshotJson: zod.string().optional(),
    overwrite: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const rawJson = request.params.path
      ? await readFile(request.params.path, 'utf8')
      : request.params.snapshotJson;
    if (!rawJson) {
      throw new Error('Either path or snapshotJson must be provided.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('Invalid snapshot JSON content.');
    }
    const normalizedRaw = parsed
      && typeof parsed === 'object'
      && (parsed as any).encrypted === true
      && (parsed as any).algorithm === 'aes-256-gcm'
      ? JSON.parse(decryptText(parsed as any))
      : parsed;
    const snapshot = normalizeSnapshot(normalizedRaw, request.params.sessionId);
    const targetId = request.params.sessionId ?? snapshot.id;
    const existing = sessionSnapshots.has(targetId);
    if (existing && request.params.overwrite !== true) {
      throw new Error(`Session snapshot already exists: ${targetId}. Set overwrite=true to replace.`);
    }

    const normalized = normalizeSnapshot({...snapshot, id: targetId}, targetId);
    sessionSnapshots.set(targetId, normalized);

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify({
      sessionId: targetId,
      loaded: true,
      overwritten: existing,
      counts: {
        cookies: normalized.cookies.length,
        localStorage: Object.keys(normalized.localStorage).length,
        sessionStorage: Object.keys(normalized.sessionStorage).length,
      },
    }, null, 2));
    response.appendResponseLine('```');
  },
});

export const checkBrowserHealth = defineTool({
  name: 'check_browser_health',
  description: 'Check browser connectivity and active page readiness before running reverse workflows.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    ensureCleanupLoop();
    cleanupExpiredSessions();
    const runtime = getJSHookRuntime();
    const issues: Array<{code: string; message: string}> = [];
    const browser = runtime.browserManager.getBrowser();
    const connected = Boolean(browser && browser.isConnected());
    if (!connected) {
      issues.push({
        code: 'BROWSER_DISCONNECTED',
        message: 'Browser is not connected. Use browserUrl/wsEndpoint or start remote debugging.',
      });
    }

    let pageReady = false;
    let url: string | null = null;
    let title: string | null = null;
    try {
      const page = await runtime.pageController.getPage();
      pageReady = true;
      url = page.url();
      title = await page.title();
      await runtime.pageController.evaluate('1+1');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        code: 'NO_ACTIVE_PAGE',
        message: `No controllable active page: ${message}`,
      });
    }

    const result = {
      healthy: issues.length === 0,
      connected,
      pageReady,
      currentPage: {url, title},
      recommendations: [
        !connected ? 'Start Chrome with --remote-debugging-port and reconnect MCP.' : null,
        connected && !pageReady ? 'Open/select a target page, then retry health check.' : null,
      ].filter((item): item is string => Boolean(item)),
      issues,
    };

    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});
