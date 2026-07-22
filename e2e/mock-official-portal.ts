// Mock of the official passport portal (online.nepalpassport.gov.np) used only
// by the import-official e2e spec. The app is pointed here via the
// EPP_OFFICIAL_ORIGIN e2e hook — tests never touch the real government site.
// Scenarios are switched via POST /__scenario__ (or setScenario directly).
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type PortalScenario = 'normal' | 'expired' | 'html_error';

// The login page asks "2 + 3 = ?".
export const CAPTCHA_ANSWER = '5';

// Synthetic opaque token (NOT a dot-separated JWT) — mirrors the real
// portal, whose `jwt` value is an opaque encoded string. This is what the
// page-context fetch script must find under the exact key `jwt`.
const OPAQUE_TOKEN = 'QVVUSC1lMmUtc3ludGhldGljLW9wYXF1ZS10b2tlbi12MQ';

// Mirrors the real portal's Spring Security setup: login sets a readable
// XSRF-TOKEN cookie and POSTs 403 without the matching X-XSRF-TOKEN header.
const XSRF_TOKEN = 'e2e-xsrf-token';

// The real search endpoint rejects criteria bodies whose accountId does not
// match the signed-in account's `accountId` cookie with a 401.
const ACCOUNT_ID = 'e2e-account-1';

const APPLICATIONS = [
  {
    applicationId: 'WPT-900001',
    givenName: 'Maya',
    surname: 'Gurung',
    applicationType: 'NEW',
    submittedDate: '2026-07-10',
    status: 'SUBMITTED',
  },
  {
    applicationId: 'WPT-900002',
    givenName: 'Kiran',
    surname: 'Shrestha',
    applicationType: 'RENEW',
    submittedDate: '2026-07-12',
    status: 'DRAFT',
  },
];

// The live portal's search response: data.pagedResults with a nested DTO per
// entry (this is the shape the desktop summary mapper must understand).
function searchEntry(application: (typeof APPLICATIONS)[number]): Record<string, unknown> {
  return {
    applicationMetaDataDTO: {
      applicationID: application.applicationId,
      useCase: application.applicationType,
      applicationState: application.status,
      submittedDate: application.submittedDate,
    },
    applicantsDTO: {
      applicantDTOList: [
        {
          demographicDataDTO: {
            personDataDTO: {
              givenName: application.givenName,
              surname: application.surname,
              dateOfBirth: '1995-04-12',
            },
          },
        },
      ],
    },
  };
}

const DETAILS: Record<string, Record<string, unknown>> = {
  'WPT-900001': {
    applicationId: 'WPT-900001',
    applicationType: 'NEW',
    status: 'SUBMITTED',
    personalDetails: {
      givenName: 'Maya',
      surname: 'Gurung',
      dateOfBirth: '1995-04-12',
      gender: 'F',
      citizenshipNumber: '12-34-56-78901',
      nationalIdNumber: '9876543210',
    },
    contactDetails: {
      phone: '+9779841999001',
      email: 'maya.gurung@example.com',
    },
    address: {
      province: 'Bagmati',
      district: 'Kathmandu',
      municipality: 'Kathmandu Metropolitan City',
      wardNumber: '4',
      street: 'Thamel',
    },
    // Decoys: the Electron main-process sanitizer must strip these before the
    // payload crosses IPC; the mock Django preview 400s if they survive.
    authToken: 'decoy-token-that-must-never-cross-ipc',
    biometricImage: 'ZGVjb3ktYmlvbWV0cmljLWJsb2ItdGhhdC1tdXN0LWJlLXN0cmlwcGVk',
  },
  'WPT-900002': {
    applicationId: 'WPT-900002',
    applicationType: 'RENEW',
    status: 'DRAFT',
    personalDetails: {
      givenName: 'Kiran',
      surname: 'Shrestha',
      dateOfBirth: '1988-11-02',
      gender: 'M',
      citizenshipNumber: '98-76-54-32109',
    },
    contactDetails: {
      phone: '+9779841999002',
      email: 'kiran.shrestha@example.com',
    },
    previousPassport: {
      previousDocumentNumber: 'PA1234567',
      previousDocumentIssueDate: '2016-01-15',
    },
    authToken: 'decoy-token-that-must-never-cross-ipc',
    biometricImage: 'ZGVjb3ktYmlvbWV0cmljLWJsb2ItdGhhdC1tdXN0LWJlLXN0cmlwcGVk',
  },
};

function loginPage(error = ''): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Official Passport Portal — Sign in</title></head>
  <body>
    <h1>Official Passport Portal</h1>
    ${error ? `<p role="alert" style="color:red">${error}</p>` : ''}
    <form method="POST" action="/account/login">
      <label>Email <input id="email" name="email" type="email"></label>
      <label>Password <input id="password" name="password" type="password"></label>
      <label>What is 2 + 3? <input id="captcha" name="captcha" type="text"></label>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`;
}

function signedInPage(): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Official Passport Portal — My applications</title></head>
  <body>
    <script>localStorage.setItem('jwt', '${OPAQUE_TOKEN}');</script>
    <h1>Signed in to the official portal</h1>
    <p>Your applications</p>
    <ul>
      <li>WPT-900001 — Maya Gurung</li>
      <li>WPT-900002 — Kiran Shrestha</li>
    </ul>
  </body>
</html>`;
}

const MAINTENANCE_PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Maintenance</title></head>
  <body><h1>Scheduled maintenance — please try again later</h1></body>
</html>`;

export class MockOfficialPortal {
  private server: http.Server;
  private scenario: PortalScenario = 'normal';
  private port = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  start(port = 0): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(port, '127.0.0.1', () => {
        this.port = (this.server.address() as AddressInfo).port;
        resolve(this.port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  setScenario(scenario: PortalScenario): void {
    this.scenario = scenario;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (path === '/__scenario__' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { name: PortalScenario };
      this.setScenario(body.name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    if (path === '/account/login' && req.method === 'GET') {
      return this.html(res, loginPage());
    }

    if (path === '/account/login' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      // A wrong CAPTCHA keeps the user on the login page with an error and
      // never sets a token — exactly like the real portal.
      if ((params.get('captcha') ?? '').trim() !== CAPTCHA_ANSWER) {
        return this.html(res, loginPage('Incorrect CAPTCHA answer — try again.'));
      }
      return this.html(res, signedInPage(), {
        'Set-Cookie': [
          `jwt=${OPAQUE_TOKEN}; Path=/`,
          `XSRF-TOKEN=${XSRF_TOKEN}; Path=/`,
          `accountId=${ACCOUNT_ID}; Path=/`,
        ],
      });
    }

    if (path === '/process-state-controller/public/applications/search' && req.method === 'POST') {
      const raw = await readBody(req);
      if (!this.authorized(req, res)) return;
      if (!this.xsrfOk(req, res)) return;
      let criteria: Record<string, unknown> = {};
      try {
        criteria = JSON.parse(raw || '{}') as Record<string, unknown>;
      } catch {
        criteria = {};
      }
      if (criteria.accountId !== ACCOUNT_ID) {
        return this.json(res, 401, { message: 'Account context missing or mismatched' });
      }
      if (this.scenario === 'html_error') return this.html(res, MAINTENANCE_PAGE);
      return this.json(res, 200, {
        data: { count: APPLICATIONS.length, pagedResults: APPLICATIONS.map(searchEntry) },
      });
    }

    const detailMatch = path.match(/^\/process-state-controller\/public\/applications\/([^/]+)$/);
    if (detailMatch && req.method === 'GET') {
      if (!this.authorized(req, res)) return;
      if (this.scenario === 'html_error') return this.html(res, MAINTENANCE_PAGE);
      const id = decodeURIComponent(detailMatch[1]);
      const detail = DETAILS[id];
      if (!detail) return this.json(res, 404, { message: 'Application not found' });
      return this.json(res, 200, detail);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `No mock route for ${req.method} ${path}` }));
  }

  private authorized(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const auth = req.headers.authorization ?? '';
    // Exact opaque-token match — an eyJ-shaped JWT must NOT be required (and
    // a wrong/missing token must fail).
    if (this.scenario !== 'expired' && auth === `Bearer ${OPAQUE_TOKEN}`) return true;
    this.json(res, 401, { message: 'Unauthorized' });
    return false;
  }

  private xsrfOk(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (req.headers['x-xsrf-token'] === XSRF_TOKEN) return true;
    this.json(res, 403, { message: 'Forbidden' });
    return false;
  }

  private html(
    res: http.ServerResponse,
    body: string,
    headers: Record<string, string | string[]> = {},
  ): void {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  }

  private json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
  });
}
