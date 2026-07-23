import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageFetchResult } from '../../src/main/official-import';

// --- Fake electron ------------------------------------------------------------
// Everything lives inside the factory: vi.mock is hoisted above the module
// body, so top-level bindings are not initialized when the factory runs.

type Handler = (...args: never[]) => void;

vi.mock('electron', () => {
  class FakeSession {
    setPermissionRequestHandler = vi.fn();
    setPermissionCheckHandler = vi.fn();
    clearStorageData = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    clearCache = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    clearAuthCache = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  }

  class FakeWebContents {
    handlers = new Map<string, Handler>();
    windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
    session = new FakeSession();
    executeJavaScript = vi.fn();
    isLoading = vi.fn(() => false);
    send = vi.fn();

    on(event: string, fn: Handler): void {
      this.handlers.set(event, fn);
    }

    setWindowOpenHandler(fn: (details: { url: string }) => { action: string }): void {
      this.windowOpenHandler = fn;
    }
  }

  class FakeBrowserWindow {
    static created: FakeBrowserWindow[] = [];
    // Tests can override what the next window's loadURL does.
    static loadURLImpl: (() => Promise<void>) | null = null;

    webContents = new FakeWebContents();
    handlers = new Map<string, Handler>();
    destroyed = false;
    show = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn<(url: string) => Promise<void>>((_url: string) =>
      FakeBrowserWindow.loadURLImpl ? FakeBrowserWindow.loadURLImpl() : Promise.resolve(),
    );

    constructor(readonly options: Record<string, unknown>) {
      FakeBrowserWindow.created.push(this);
    }

    on(event: string, fn: Handler): void {
      this.handlers.set(event, fn);
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    close(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      this.handlers.get('closed')?.();
    }

    destroy(): void {
      this.close();
    }
  }

  return {
    BrowserWindow: FakeBrowserWindow,
    shell: { openExternal: vi.fn() },
    app: { on: vi.fn() },
  };
});

import { BrowserWindow, app, shell } from 'electron';

type FakeBrowserWindowType = InstanceType<typeof BrowserWindow> & {
  options: Record<string, unknown>;
  handlers: Map<string, Handler>;
  destroyed: boolean;
  webContents: {
    handlers: Map<string, Handler>;
    windowOpenHandler: ((details: { url: string }) => { action: string }) | null;
    session: {
      setPermissionRequestHandler: ReturnType<typeof vi.fn>;
      setPermissionCheckHandler: ReturnType<typeof vi.fn>;
      clearStorageData: ReturnType<typeof vi.fn>;
      clearCache: ReturnType<typeof vi.fn>;
      clearAuthCache: ReturnType<typeof vi.fn>;
    };
    executeJavaScript: ReturnType<typeof vi.fn>;
    isLoading: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  close(): void;
};

function createdWindows(): FakeBrowserWindowType[] {
  return (BrowserWindow as unknown as { created: FakeBrowserWindowType[] }).created;
}

const openExternalMock = vi.mocked(shell.openExternal);
const appOnMock = vi.mocked(app.on);

import { ValidationError } from '../../src/shared/ipc-contract';
import { ApiError } from '../../src/main/api-client';
import {
  OFFICIAL_ORIGIN,
  OfficialImportSession,
  buildPageFetchScript,
  extractApplicationList,
  extractSupportingDocuments,
  getOfficialImportSession,
  pageResultError,
  sanitizeOfficialJson,
  toApplicationSummary,
} from '../../src/main/official-import';

// --- Helpers ------------------------------------------------------------------

function makeSession(): {
  session: OfficialImportSession;
  mainWindow: {
    webContents: {
      send: ReturnType<typeof vi.fn>;
      isDestroyed(): boolean;
      isCrashed(): boolean;
    };
    isDestroyed(): boolean;
  };
} {
  const mainWindow = {
    webContents: { send: vi.fn(), isDestroyed: () => false, isCrashed: () => false },
    isDestroyed: () => false,
  };
  const session = new OfficialImportSession({ getWindow: () => mainWindow as never });
  return { session, mainWindow };
}

function lastPortalWindow(): FakeBrowserWindowType {
  const created = createdWindows();
  const win = created[created.length - 1];
  if (!win) throw new Error('no portal window created');
  return win;
}

function canned(result: PageFetchResult): void {
  lastPortalWindow().webContents.executeJavaScript.mockResolvedValue(result);
}

function setLoadURLImpl(impl: (() => Promise<void>) | null): void {
  (BrowserWindow as unknown as { loadURLImpl: (() => Promise<void>) | null }).loadURLImpl = impl;
}

beforeEach(() => {
  createdWindows().length = 0;
  setLoadURLImpl(null);
  openExternalMock.mockClear();
  appOnMock.mockClear();
});

// --- Window setup ---------------------------------------------------------------

describe('OfficialImportSession.open', () => {
  it('creates a locked-down window with a non-persistent partition and no preload', async () => {
    const { session } = makeSession();
    await session.open();
    const win = lastPortalWindow();
    const prefs = win.options.webPreferences as Record<string, unknown>;
    expect(win.options.title).toBe('Official Passport Portal');
    expect(win.options.show).toBe(false);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.devTools).toBe(false);
    expect(prefs.preload).toBeUndefined();
    expect(prefs.partition).toMatch(/^official-import-\d+$/);
    expect(String(prefs.partition)).not.toContain('persist:');
    expect(win.loadURL).toHaveBeenCalledWith(`${OFFICIAL_ORIGIN}/account/login`);
  });

  it('notifies the main window on open and close', async () => {
    const { session, mainWindow } = makeSession();
    await session.open();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('official-import-state', {
      type: 'official-import-state',
      state: 'opened',
    });
    await session.close();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('official-import-state', {
      type: 'official-import-state',
      state: 'closed',
    });
  });

  it('skips notifications when the renderer frame is crashed or destroyed', async () => {
    const { session, mainWindow } = makeSession();
    mainWindow.webContents.isCrashed = () => true;
    await session.open();
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    mainWindow.webContents.isCrashed = () => false;
    mainWindow.webContents.isDestroyed = () => true;
    await session.close();
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('swallows a frame-disposed error thrown mid-send', async () => {
    const { session, mainWindow } = makeSession();
    mainWindow.webContents.send.mockImplementation(() => {
      throw new Error('Render frame was disposed before WebFrameMain could be accessed');
    });
    await expect(session.open()).resolves.toEqual({ opened: true });
    await expect(session.close()).resolves.toEqual({ closed: true });
  });

  it('reuses a live window instead of opening a second one', async () => {
    const { session } = makeSession();
    await session.open();
    await session.open();
    expect(createdWindows()).toHaveLength(1);
    expect(lastPortalWindow().focus).toHaveBeenCalled();
  });
});

describe('navigation guards', () => {
  async function guardedWindow(): Promise<FakeBrowserWindowType> {
    const { session } = makeSession();
    await session.open();
    return lastPortalWindow();
  }

  it('allows same-origin navigation, blocks other origins and javascript:', async () => {
    const win = await guardedWindow();
    for (const channel of ['will-navigate', 'will-redirect']) {
      const handler = win.webContents.handlers.get(channel);
      expect(handler).toBeDefined();
      const allowed = { preventDefault: vi.fn() };
      handler!(allowed as never, `${OFFICIAL_ORIGIN}/account/login` as never);
      expect(allowed.preventDefault).not.toHaveBeenCalled();

      for (const bad of ['https://evil.com/phish', 'javascript:alert(1)', 'data:text/html,x']) {
        const blocked = { preventDefault: vi.fn() };
        handler!(blocked as never, bad as never);
        expect(blocked.preventDefault).toHaveBeenCalled();
      }
    }
  });

  it('denies popups and opens external https links in the system browser', async () => {
    const win = await guardedWindow();
    const handler = win.webContents.windowOpenHandler;
    expect(handler).not.toBeNull();
    expect(handler!({ url: 'https://example.com/page' })).toEqual({ action: 'deny' });
    expect(openExternalMock).toHaveBeenCalledWith('https://example.com/page');

    openExternalMock.mockClear();
    expect(handler!({ url: `${OFFICIAL_ORIGIN}/popup` })).toEqual({ action: 'deny' });
    expect(handler!({ url: 'http://evil.com/insecure' })).toEqual({ action: 'deny' });
    expect(handler!({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('denies all permission requests and checks', async () => {
    const win = await guardedWindow();
    const ses = win.webContents.session;
    expect(ses.setPermissionRequestHandler).toHaveBeenCalled();
    expect(ses.setPermissionCheckHandler).toHaveBeenCalled();
    const requestHandler = ses.setPermissionRequestHandler.mock.calls[0][0] as (
      wc: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void;
    const callback = vi.fn();
    requestHandler(null, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
    const checkHandler = ses.setPermissionCheckHandler.mock.calls[0][0] as () => boolean;
    expect(checkHandler()).toBe(false);
  });
});

// --- Page-script execution (synthetic tokens only) -------------------------------

interface CapturedCall {
  url: string;
  init: {
    method?: string;
    headers?: Record<string, string>;
    credentials?: string;
    body?: string;
  };
}

// Executes the generated page script with stubbed page globals and a stub
// fetch, exactly as the page would run it. Never uses real token material.
async function runPageScript(options: {
  localStorage?: Record<string, string>;
  cookie?: string;
  init?: Parameters<typeof buildPageFetchScript>[1];
  status?: number;
  contentType?: string;
  body?: unknown;
}): Promise<{ result: PageFetchResult; calls: CapturedCall[] }> {
  const script = buildPageFetchScript(
    '/process-state-controller/public/applications/search?pageNumber=1&pageSize=20',
    options.init ?? { method: 'POST', body: {} },
  );
  const calls: CapturedCall[] = [];
  const fakeFetch = (url: string, init: CapturedCall['init']) => {
    calls.push({ url, init });
    return Promise.resolve({
      status: options.status ?? 200,
      headers: { get: () => options.contentType ?? 'application/json' },
      json: () => Promise.resolve(options.body ?? { ok: true }),
    });
  };
  const fakeLocalStorage = { getItem: (key: string) => options.localStorage?.[key] ?? null };
  const fakeDocument = { cookie: options.cookie ?? '' };
  const fn = new Function(
    'localStorage',
    'document',
    'fetch',
    `return (${script})`,
  ) as (ls: unknown, doc: unknown, f: unknown) => Promise<PageFetchResult>;
  const result = await fn(fakeLocalStorage, fakeDocument, fakeFetch);
  return { result, calls };
}

describe('page script token handling', () => {
  it('accepts an opaque base64-style jwt cookie', async () => {
    const { result, calls } = await runPageScript({
      cookie: 'jwt=QVVUSC1lMmUtc3ludGhldGlj; XSRF-TOKEN=xsrf-1',
    });
    expect(result.hadToken).toBe(true);
    expect(calls[0].init.headers?.Authorization).toBe('Bearer QVVUSC1lMmUtc3ludGhldGlj');
    expect(calls[0].init.headers?.['X-XSRF-TOKEN']).toBe('xsrf-1');
  });

  it('accepts an opaque jwt from localStorage', async () => {
    const { result, calls } = await runPageScript({
      localStorage: { jwt: 'QVVUSC1sb2NhbC1zdG9yYWdl' },
    });
    expect(result.hadToken).toBe(true);
    expect(calls[0].init.headers?.Authorization).toBe('Bearer QVVUSC1sb2NhbC1zdG9yYWdl');
  });

  it('still accepts a dot-separated JWT', async () => {
    const dotJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
    const { result, calls } = await runPageScript({ cookie: `jwt=${dotJwt}` });
    expect(result.hadToken).toBe(true);
    expect(calls[0].init.headers?.Authorization).toBe(`Bearer ${dotJwt}`);
  });

  it('does not duplicate an existing Bearer prefix', async () => {
    const { calls } = await runPageScript({ localStorage: { jwt: 'Bearer abc123' } });
    expect(calls[0].init.headers?.Authorization).toBe('Bearer abc123');
  });

  it('decodes a URL-encoded token', async () => {
    const { calls } = await runPageScript({ cookie: 'jwt=abc%2Bdef%2Fghi' });
    expect(calls[0].init.headers?.Authorization).toBe('Bearer abc+def/ghi');
  });

  it('strips surrounding quotes', async () => {
    const { calls } = await runPageScript({ localStorage: { jwt: '"quoted-token"' } });
    expect(calls[0].init.headers?.Authorization).toBe('Bearer quoted-token');
  });

  it('rejects tokens containing CR or LF', async () => {
    const { result, calls } = await runPageScript({ cookie: 'jwt=abc\r\nxyz' });
    expect(result.hadToken).toBe(false);
    expect(calls[0].init.headers?.Authorization).toBeUndefined();
  });

  it('rejects oversized tokens', async () => {
    const { result, calls } = await runPageScript({ localStorage: { jwt: 'x'.repeat(9000) } });
    expect(result.hadToken).toBe(false);
    expect(calls[0].init.headers?.Authorization).toBeUndefined();
  });

  it('prefers localStorage over the cookie', async () => {
    const { calls } = await runPageScript({
      localStorage: { jwt: 'from-localstorage' },
      cookie: 'jwt=from-cookie',
    });
    expect(calls[0].init.headers?.Authorization).toBe('Bearer from-localstorage');
  });

  it('sends credentials: same-origin and never returns the token', async () => {
    const { result, calls } = await runPageScript({
      cookie: 'jwt=secret-opaque-value; accountId=acc-9',
      init: { method: 'POST', body: { status: null }, accountContext: true },
    });
    expect(calls[0].init.credentials).toBe('same-origin');
    expect(JSON.stringify(result)).not.toContain('secret-opaque-value');
    expect(JSON.stringify(result)).not.toContain('acc-9');
    // accountId goes into the in-page request body, never into the result.
    const sentBody = JSON.parse(calls[0].init.body ?? '{}') as Record<string, unknown>;
    expect(sentBody.accountId).toBe('acc-9');
    expect(sentBody.originId).toBe('WP');
    expect(sentBody.status).toBeNull();
  });

  it('reports hadToken false when no jwt exists anywhere', async () => {
    const { result, calls } = await runPageScript({
      localStorage: { other: 'value' },
      cookie: 'session=unrelated',
    });
    expect(result.hadToken).toBe(false);
    expect(calls[0].init.headers?.Authorization).toBeUndefined();
  });
});

describe('buildPageFetchScript', () => {
  it('embeds the path/method/body and never any token material', () => {
    const script = buildPageFetchScript('/some/path?q=1', { method: 'POST', body: {} });
    expect(script).toContain('"/some/path?q=1"');
    expect(script).toContain('"POST"');
    expect(script).toContain('localStorage');
    // The portal keeps its JWT in a plain cookie — the script checks both,
    // inside the page only.
    expect(script).toContain('document.cookie');
    expect(script).toContain('AbortController');
    expect(script).toContain('Bearer ');
  });

  it('echoes the Spring XSRF cookie as a header like the portal axios client', () => {
    const script = buildPageFetchScript('/some/path', { method: 'POST', body: {} });
    expect(script).toContain("readCookie('XSRF-TOKEN')");
    expect(script).toContain("headers['X-XSRF-TOKEN'] = xsrfToken");
    expect(script).toContain("'X-Requested-With': 'XMLHttpRequest'");
  });

  it('merges the portal account context into the body when requested', () => {
    const script = buildPageFetchScript('/some/path', {
      method: 'POST',
      body: { status: null },
      accountContext: true,
    });
    expect(script).toContain('withAccountContext = true');
    expect(script).toContain("readCookie('accountId')");
    expect(script).toContain("originId: 'WP'");
    const plain = buildPageFetchScript('/some/path', { method: 'POST', body: {} });
    expect(plain).toContain('withAccountContext = false');
  });
});

// --- Error mapping ------------------------------------------------------------

describe('pageResultError', () => {
  const cases: Array<[PageFetchResult, string, boolean]> = [
    [{ status: 401, hadToken: true }, 'SESSION_EXPIRED', false],
    [{ status: 403, hadToken: true }, 'SESSION_EXPIRED', false],
    [{ status: 404 }, 'NOT_FOUND', false],
    [{ status: 421 }, 'RATE_LIMITED', true],
    [{ status: 429 }, 'RATE_LIMITED', true],
    [{ status: 500 }, 'OFFICIAL_UNAVAILABLE', true],
    [{ status: 503 }, 'OFFICIAL_UNAVAILABLE', true],
    [{ status: 0, error: 'timeout' }, 'TIMEOUT', true],
    [{ status: 0, error: 'network' }, 'OFFICIAL_UNAVAILABLE', true],
    [{ status: 200, contentType: 'text/html', body: null }, 'UNEXPECTED_RESPONSE', false],
    [{ status: 200, contentType: 'application/json', body: null }, 'UNEXPECTED_RESPONSE', false],
    [{ status: 418 }, 'UNEXPECTED_RESPONSE', false],
  ];

  it.each(cases)('%o → %s (retryable=%s)', (result, code, retryable) => {
    const error = pageResultError(result);
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.code).toBe(code);
    expect(error?.retryable).toBe(retryable);
  });

  it('distinguishes not-signed-in from session-expired in the message', () => {
    expect(pageResultError({ status: 401, hadToken: false })?.message).toMatch(/not signed in/);
    expect(pageResultError({ status: 401, hadToken: true })?.message).toMatch(/expired/);
  });

  it('accepts a healthy JSON 200', () => {
    expect(
      pageResultError({ status: 200, contentType: 'application/json; charset=utf-8', body: {} }),
    ).toBeNull();
  });
});

describe('requestInPage error surfacing', () => {
  it('maps page results to ApiError codes through list/get', async () => {
    const { session } = makeSession();
    await session.open();
    canned({ status: 429 });
    await expect(session.listApplications()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'RATE_LIMITED',
    });
    canned({ status: 401, hadToken: false });
    await expect(session.getApplication('WPT100000500')).rejects.toMatchObject({
      code: 'NOT_SIGNED_IN',
      message: expect.stringMatching(/not signed in/),
    });
  });

  it('throws OFFICIAL_WINDOW_CLOSED when the window is gone', async () => {
    const { session } = makeSession();
    await session.open();
    lastPortalWindow().close();
    await expect(session.listApplications()).rejects.toMatchObject({
      code: 'OFFICIAL_WINDOW_CLOSED',
    });
  });

  it('maps executeJavaScript failures to UNEXPECTED_RESPONSE', async () => {
    const { session } = makeSession();
    await session.open();
    lastPortalWindow().webContents.executeJavaScript.mockRejectedValue(new Error('crashed'));
    await expect(session.listApplications()).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    });
  });
});

// --- Sanitizer ------------------------------------------------------------

describe('sanitizeOfficialJson', () => {
  it('drops dangerous keys recursively', () => {
    const cleaned = sanitizeOfficialJson({
      givenName: 'Ram',
      accessToken: 'eyJhbGciOiJ9.eyJzdWIiOiJ4In0.sig',
      nested: {
        cookie: 'sessionid=abc',
        jwtSecret: 'x',
        authorizationHeader: 'Bearer y',
        biometric: { faceTemplate: 'z' },
        profilePhoto: 'base64...',
        receiptImage: 'base64...',
        paymentTransactionId: '123',
        accountNumber: '456',
        passwordHint: 'h',
        captchaAnswer: 'c',
        documentScan: 'base64...',
      },
    }) as Record<string, unknown>;
    expect(cleaned.givenName).toBe('Ram');
    expect(cleaned.accessToken).toBeUndefined();
    const nested = cleaned.nested as Record<string, unknown>;
    expect(Object.keys(nested)).toEqual([]);
  });

  it('keeps exempted document/passport mapping keys', () => {
    const cleaned = sanitizeOfficialJson({
      documentSubtype: 'ORDINARY',
      documentType: 'PASSPORT',
      previousDocumentType: 'PASSPORT',
      previousDocumentNumber: 'PA1234567',
      ordinaryType: 'NORMAL',
      passportType: 'REGULAR',
      document_subtype: 'ORDINARY',
      previous_document_number: 'PA1234567',
    }) as Record<string, unknown>;
    expect(cleaned.documentSubtype).toBe('ORDINARY');
    expect(cleaned.previousDocumentNumber).toBe('PA1234567');
    expect(cleaned.document_subtype).toBe('ORDINARY');
    expect(cleaned.previous_document_number).toBe('PA1234567');
  });

  it('drops string values longer than 4000 chars', () => {
    const cleaned = sanitizeOfficialJson({
      short: 'x'.repeat(4000),
      long: 'y'.repeat(4001),
    }) as Record<string, unknown>;
    expect(cleaned.short).toHaveLength(4000);
    expect(cleaned.long).toBeUndefined();
  });

  it('caps arrays at 100 items and depth at 8', () => {
    const cleaned = sanitizeOfficialJson({
      items: Array.from({ length: 150 }, (_, i) => i),
    }) as Record<string, unknown>;
    expect(cleaned.items).toHaveLength(100);

    let deep: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < 12; i += 1) deep = { next: deep };
    const cleanedDeep = sanitizeOfficialJson(deep);
    let node = cleanedDeep as Record<string, unknown>;
    let levels = 0;
    while (node && typeof node === 'object' && 'next' in node) {
      node = node.next as Record<string, unknown>;
      levels += 1;
    }
    expect(levels).toBeLessThanOrEqual(8);
  });

  it('throws ValidationError above the 256KB size cap', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 70; i += 1) big[`field_${i}`] = 'x'.repeat(4000);
    expect(() => sanitizeOfficialJson(big)).toThrow(ValidationError);
  });
});

describe('extractSupportingDocuments', () => {
  it('keeps only well-shaped entries with at least one scanned image', () => {
    const documents = extractSupportingDocuments({
      supportingDocumentsData: [
        { documentType: 'citizenshipCertificate', documents: ['aGVsbG8=', 'd29ybGQ='] },
        { documentType: 'academicCertificate', documents: [] }, // nothing scanned
        { documentType: '', documents: ['aGVsbG8='] }, // no type
        { documentType: 'nationalEID' }, // missing documents array
        'not-an-object',
      ],
    });
    expect(documents).toEqual([
      { documentType: 'citizenshipCertificate', documents: ['aGVsbG8=', 'd29ybGQ='] },
    ]);
  });

  it('drops non-base64 strings and caps images per document at 5', () => {
    const images = ['aGVsbG8=', 'not base64!', 'd29ybGQ=', 'aGVsbG8=', 'd29ybGQ=', 'aGVsbG8=', 'd29ybGQ='];
    const documents = extractSupportingDocuments({
      supportingDocumentsData: [{ documentType: 'nationalEID', documents: images }],
    });
    expect(documents).toHaveLength(1);
    expect(documents[0].documents).toHaveLength(5);
    expect(documents[0].documents).not.toContain('not base64!');
  });

  it('returns an empty array when the field is absent or malformed', () => {
    expect(extractSupportingDocuments({})).toEqual([]);
    expect(extractSupportingDocuments({ supportingDocumentsData: 'nope' })).toEqual([]);
    expect(extractSupportingDocuments(null)).toEqual([]);
  });

  it('finds supportingDocumentsData nested under an arbitrary wrapper, not just top-level', () => {
    const documents = extractSupportingDocuments({
      applicationId: 'WPT100000500',
      data: {
        applicantsDTO: {
          supportingDocumentsData: [
            { documentType: 'citizenshipCertificate', documents: ['aGVsbG8='] },
          ],
        },
      },
    });
    expect(documents).toEqual([{ documentType: 'citizenshipCertificate', documents: ['aGVsbG8='] }]);
  });
});

// --- List mapping ------------------------------------------------------------

describe('listApplications', () => {
  it('maps a realistic nested official search response', async () => {
    const { session } = makeSession();
    await session.open();
    canned({
      status: 200,
      contentType: 'application/json',
      body: {
        data: {
          content: [
            {
              applicationId: 'WPT100000500',
              givenName: 'Ram',
              surname: 'Sharma',
              applicationType: 'New Passport',
              submittedDate: '2026-01-05',
              status: 'SUBMITTED',
              token: 'should-be-stripped',
            },
            {
              id: 'WPT100000501',
              applicantName: 'Sita KC',
              type: 'Renewal',
              createdAt: '2026-02-01',
              applicationStatus: 'DRAFT',
            },
          ],
          totalElements: 2,
        },
      },
    });
    const list = await session.listApplications();
    expect(list).toEqual([
      {
        id: 'WPT100000500',
        applicant_name: 'Ram Sharma',
        application_type: 'New Passport',
        submitted_at: '2026-01-05',
        status: 'SUBMITTED',
      },
      {
        id: 'WPT100000501',
        applicant_name: 'Sita KC',
        application_type: 'Renewal',
        submitted_at: '2026-02-01',
        status: 'DRAFT',
      },
    ]);
  });

  it('handles a bare array body and empty results', async () => {
    const { session } = makeSession();
    await session.open();
    canned({ status: 200, contentType: 'application/json', body: [] });
    expect(await session.listApplications()).toEqual([]);
  });

  it('maps the live pagedResults DTO shape and strips decoy keys', async () => {
    const { session } = makeSession();
    await session.open();
    canned({
      status: 200,
      contentType: 'application/json',
      body: {
        data: {
          count: 1,
          pagedResults: [
            {
              applicationMetaDataDTO: {
                applicationID: 'WPT-900001',
                useCase: 'NEW',
                applicationState: 'SUBMITTED',
                submittedDate: '2026-07-10',
              },
              applicantsDTO: {
                applicantDTOList: [
                  {
                    demographicDataDTO: {
                      personDataDTO: {
                        givenName: 'Maya',
                        surname: 'Gurung',
                        dateOfBirth: '1995-04-12',
                      },
                    },
                  },
                ],
              },
              authToken: 'decoy-must-not-cross',
              biometricImage: 'decoy-must-not-cross',
            },
          ],
        },
      },
    });
    expect(await session.listApplications()).toEqual([
      {
        id: 'WPT-900001',
        applicant_name: 'Maya Gurung',
        application_type: 'NEW',
        submitted_at: '2026-07-10',
        status: 'SUBMITTED',
      },
    ]);
  });
});

describe('extractApplicationList / toApplicationSummary', () => {
  it('unwraps one level of data nesting', () => {
    expect(extractApplicationList({ data: { data: [{ id: 1 }] } })).toEqual([{ id: 1 }]);
    expect(extractApplicationList({ results: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    expect(extractApplicationList({ data: { pagedResults: [{ id: 3 }] } })).toEqual([{ id: 3 }]);
    expect(extractApplicationList({ nothing: 1 })).toEqual([]);
    expect(extractApplicationList('nope')).toEqual([]);
  });

  it('maps the live nested DTO search-entry shape', () => {
    const summary = toApplicationSummary({
      applicationMetaDataDTO: {
        applicationID: 'WPT-900001',
        useCase: 'RENEW',
        applicationState: 'SUBMITTED',
        submittedDate: '2026-07-10',
      },
      applicantsDTO: {
        applicantDTOList: [
          {
            demographicDataDTO: {
              personDataDTO: { givenName: 'Maya', surname: 'Gurung', dateOfBirth: '1995-04-12' },
            },
          },
        ],
      },
      authToken: 'decoy-must-not-cross',
    });
    expect(summary).toEqual({
      id: 'WPT-900001',
      applicant_name: 'Maya Gurung',
      application_type: 'RENEW',
      submitted_at: '2026-07-10',
      status: 'SUBMITTED',
    });
  });

  it('coerces values to strings capped at 200 chars', () => {
    const summary = toApplicationSummary({ id: 12345, name: 'x'.repeat(300) });
    expect(summary.id).toBe('12345');
    expect(summary.applicant_name).toHaveLength(200);
    expect(summary.status).toBe('');
  });
});

// --- Detail fetch ------------------------------------------------------------

describe('getApplication', () => {
  it('returns sanitized detail JSON with no auth keys', async () => {
    const { session } = makeSession();
    await session.open();
    canned({
      status: 200,
      contentType: 'application/json',
      body: {
        applicationId: 'WPT100000500',
        givenName: 'Ram',
        surname: 'Sharma',
        documentSubtype: 'ORDINARY',
        accessToken: 'eyJhbGciOiJ9.eyJzdWIiOiJ4In0.sig',
        refreshToken: 'eyJhbGciOiJ9.eyJzdWIiOiJ4In0.sig2',
        sessionId: 'abc123',
        cookies: 'a=b',
        profileImage: 'data:image/png;base64,...',
      },
    });
    const detail = await session.getApplication('WPT100000500');
    expect(detail).toEqual({
      applicationId: 'WPT100000500',
      givenName: 'Ram',
      surname: 'Sharma',
      documentSubtype: 'ORDINARY',
      supportingDocumentsData: [],
    });
    const script = lastPortalWindow().webContents.executeJavaScript.mock.calls[0][0] as string;
    expect(script).toContain('/process-state-controller/public/applications/WPT100000500');
    expect(script).toContain('"GET"');
  });

  it('carries supportingDocumentsData through untouched by the generic sanitizer', async () => {
    const { session } = makeSession();
    await session.open();
    canned({
      status: 200,
      contentType: 'application/json',
      body: {
        applicationId: 'WPT100000500',
        supportingDocumentsData: [
          { documentType: 'citizenshipCertificate', documents: ['aGVsbG8=', 'd29ybGQ='] },
        ],
      },
    });
    const detail = await session.getApplication('WPT100000500');
    expect(detail.supportingDocumentsData).toEqual([
      { documentType: 'citizenshipCertificate', documents: ['aGVsbG8=', 'd29ybGQ='] },
    ]);
  });
});

// --- Session wiping ------------------------------------------------------------

describe('hang guards', () => {
  it('shows the window after a fallback delay even without first paint', async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeSession();
      await session.open();
      const win = lastPortalWindow();
      expect(win.show).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      expect(win.show).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails with OFFICIAL_UNAVAILABLE when the login page never finishes loading', async () => {
    vi.useFakeTimers();
    try {
      setLoadURLImpl(() => new Promise<never>(() => undefined));
      const { session } = makeSession();
      const openPromise = session.open();
      const assertion = expect(openPromise).rejects.toMatchObject({
        code: 'OFFICIAL_UNAVAILABLE',
      });
      await vi.advanceTimersByTimeAsync(31000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out instead of hanging when executeJavaScript never settles', async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeSession();
      await session.open();
      lastPortalWindow().webContents.executeJavaScript.mockReturnValue(
        new Promise<never>(() => undefined),
      );
      const listPromise = session.listApplications();
      const assertion = expect(listPromise).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(26000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out when the page never stops loading', async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeSession();
      await session.open();
      lastPortalWindow().webContents.isLoading.mockReturnValue(true);
      const listPromise = session.listApplications();
      const assertion = expect(listPromise).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(11000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports blocked navigations to the main window', async () => {
    const { session, mainWindow } = makeSession();
    await session.open();
    const win = lastPortalWindow();
    const handler = win.webContents.handlers.get('will-navigate');
    const event = { preventDefault: vi.fn() };
    handler!(event as never, 'https://evil.example.com/steal' as never);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('official-import-state', {
      type: 'official-import-state',
      state: 'blocked-navigation',
      host: 'evil.example.com',
    });
  });
});

// --- Session wiping ------------------------------------------------------------

describe('session wiping', () => {
  it('clears storage, cache and auth cache on explicit close', async () => {
    const { session } = makeSession();
    await session.open();
    const ses = lastPortalWindow().webContents.session;
    await session.close();
    expect(ses.clearStorageData).toHaveBeenCalled();
    expect(ses.clearCache).toHaveBeenCalled();
    expect(ses.clearAuthCache).toHaveBeenCalled();
  });

  it('wipes when the user closes the window directly', async () => {
    const { session } = makeSession();
    await session.open();
    const win = lastPortalWindow();
    win.close();
    await Promise.resolve();
    expect(win.webContents.session.clearStorageData).toHaveBeenCalled();
    expect(win.webContents.session.clearCache).toHaveBeenCalled();
  });

  it('registers a single before-quit wipe in the shared factory', () => {
    const deps = { getWindow: () => null };
    const first = getOfficialImportSession(deps);
    const second = getOfficialImportSession(deps);
    expect(first).toBe(second);
    const quitCalls = appOnMock.mock.calls.filter(
      ([event]) => (event as string) === 'before-quit',
    );
    expect(quitCalls).toHaveLength(1);
  });
});
