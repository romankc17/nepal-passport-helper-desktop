// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ClientSummary } from '../../../src/shared/types';
import { ImportOfficialDialog } from '../../../src/renderer/src/components/import-official/ImportOfficialDialog';
import { bridgeError, installDesktopMock, renderWithProviders } from './test-utils';

const APPLICATION = {
  id: 'WPT-1234567',
  applicant_name: 'Ram Sharma',
  application_type: 'First issuance',
  submitted_at: '2024-05-01',
  status: 'Submitted',
};

// A sanitized official detail payload — deliberately free of any auth/session keys.
const OFFICIAL_DETAIL = {
  applicationId: 'WPT-1234567',
  applicant: { givenName: 'Ram', surname: 'Sharma', gender: 'M' },
  submittedAt: '2024-05-01',
};

const PREVIEW = {
  fields: {
    given_name: 'Ram',
    surname: 'Sharma',
    gender: 'M',
    application_type: 'NEW',
    phone: '9841000000',
  },
  warnings: [{ field: 'phone', source_value: '+977-9841', reason: 'Phone number was normalized' }],
  unmapped: { barcode: 'XYZ123' },
  requirements: [
    { type: 'citizenship', label: 'Citizenship certificate', required: true, present: false },
  ],
  duplicate: null,
};

const CLIENT: ClientSummary = {
  id: 42,
  full_name: 'Ram Sharma',
  application_type: 'First issuance (new)',
  status: 'fresh',
  desktop_status: 'incomplete',
  can_book: false,
  official_application_id: '',
  provider_id: 0,
  provider_name: '',
  district_name: '',
  phone: '9841000000',
  email: '',
  missing_document_count: 1,
  queued_booking_id: null,
  created_at: '2025-01-01T00:00:00Z',
  appointment: null,
  created_by: 'agent',
};

const CONFIRM_RESULT = { client: CLIENT, edit_url: '/clients/42/change/' };

function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      collectKeys(nested, into);
    }
  }
}

describe('ImportOfficialDialog', () => {
  beforeEach(() => {
    const desktop = installDesktopMock();
    vi.clearAllMocks();
    desktop.settings.get = vi.fn().mockResolvedValue({
      apiUrl: null,
      notificationsEnabled: true,
      soundEnabled: true,
      minimizeToTray: true,
      startOnLogin: false,
      defaultIntervalSeconds: 300,
      defaultDaysAhead: 14,
      theme: 'system',
    });
    if (typeof window.crypto.randomUUID !== 'function') {
      Object.defineProperty(window.crypto, 'randomUUID', {
        value: () => `test-uuid-${Math.random().toString(16).slice(2)}`,
        configurable: true,
      });
    }
  });

  afterEach(() => {
    cleanup();
  });

  function renderDialog(onCreated = vi.fn(), onOpenChange = vi.fn()) {
    renderWithProviders(
      <ImportOfficialDialog open onOpenChange={onOpenChange} onCreated={onCreated} />,
    );
    return { onCreated, onOpenChange };
  }

  async function reachSignInStep() {
    await userEvent.click(screen.getByTestId('import-open-portal'));
    return screen.findByRole('button', { name: 'I have signed in — Continue' });
  }

  // The caller stubs officialImport.list before invoking this helper.
  async function reachSelectStep() {
    await reachSignInStep();
    await userEvent.click(screen.getByRole('button', { name: 'I have signed in — Continue' }));
    return screen.findByTestId(`import-application-${APPLICATION.id}`);
  }

  // The caller stubs officialImport.list/get + clients.importPreview first.
  async function reachReviewStep() {
    const radio = await reachSelectStep();
    await userEvent.click(radio);
    await userEvent.click(screen.getByTestId('import-select-continue'));
    return screen.findByTestId('import-review');
  }

  it('walks the happy path and never sends auth/session keys over the bridge', async () => {
    const desktop = installDesktopMock();
    desktop.officialImport.list = vi.fn().mockResolvedValue([APPLICATION]);
    desktop.officialImport.get = vi.fn().mockResolvedValue(OFFICIAL_DETAIL);
    desktop.clients.importPreview = vi.fn().mockResolvedValue(PREVIEW);
    desktop.clients.importConfirm = vi.fn().mockResolvedValue(CONFIRM_RESULT);
    const { onCreated, onOpenChange } = renderDialog();

    await reachReviewStep();
    expect(screen.getByText('Ready for review…')).toBeInTheDocument();

    // Edit one mapped field before confirming.
    const givenName = screen.getByTestId('import-field-given_name');
    await userEvent.clear(givenName);
    await userEvent.type(givenName, 'Hari');

    await userEvent.click(screen.getByTestId('import-confirm-create'));
    await screen.findByText('Client created as Fresh');

    expect(desktop.clients.importConfirm).toHaveBeenCalledTimes(1);
    const confirmInput = (desktop.clients.importConfirm as unknown as Mock).mock.calls[0][0];
    expect(confirmInput.fields.given_name).toBe('Hari');
    expect(confirmInput.allow_duplicate).toBe(false);
    expect(typeof confirmInput.idempotency_key).toBe('string');
    expect(confirmInput.idempotency_key.length).toBeGreaterThan(0);

    await userEvent.click(screen.getByTestId('import-view-client'));
    expect(onCreated).toHaveBeenCalledWith(CLIENT);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Security invariant: no channel ever carried keys matching auth patterns.
    const keys = new Set<string>();
    for (const fn of [
      desktop.officialImport.open,
      desktop.officialImport.list,
      desktop.officialImport.get,
      desktop.officialImport.close,
      desktop.clients.importPreview,
      desktop.clients.importConfirm,
    ] as unknown as Mock[]) {
      for (const call of fn.mock.calls) collectKeys(call, keys);
    }
    for (const key of keys) {
      expect(key).not.toMatch(/token|password|captcha|cookie|authorization/i);
    }
  });

  it('carries supportingDocumentsData to importConfirm without leaking it into importPreview', async () => {
    const documents = [{ documentType: 'citizenshipCertificate', documents: ['aGVsbG8=', 'd29ybGQ='] }];
    const desktop = installDesktopMock();
    desktop.officialImport.list = vi.fn().mockResolvedValue([APPLICATION]);
    desktop.officialImport.get = vi
      .fn()
      .mockResolvedValue({ ...OFFICIAL_DETAIL, supportingDocumentsData: documents });
    desktop.clients.importPreview = vi.fn().mockResolvedValue(PREVIEW);
    desktop.clients.importConfirm = vi.fn().mockResolvedValue(CONFIRM_RESULT);
    renderDialog();

    await reachReviewStep();
    await userEvent.click(screen.getByTestId('import-confirm-create'));
    await screen.findByText('Client created as Fresh');

    const previewInput = (desktop.clients.importPreview as unknown as Mock).mock.calls[0][0];
    expect(previewInput.application.supportingDocumentsData).toBeUndefined();

    const confirmInput = (desktop.clients.importConfirm as unknown as Mock).mock.calls[0][0];
    expect(confirmInput.supporting_documents).toEqual(documents);
  });

  it('SESSION_EXPIRED on list shows the session message and returns to sign-in', async () => {
    const desktop = installDesktopMock();
    desktop.officialImport.list = vi
      .fn()
      .mockRejectedValueOnce(bridgeError('SESSION_EXPIRED', 'Session expired'))
      .mockResolvedValueOnce([APPLICATION]);
    renderDialog();

    await reachSignInStep();
    await userEvent.click(screen.getByRole('button', { name: 'I have signed in — Continue' }));

    await screen.findByText(
      'Your official portal session was rejected or expired — please sign in again',
    );
    // Back on the sign-in step, and the portal window was re-opened/focused.
    expect(
      screen.getByRole('button', { name: 'I have signed in — Continue' }),
    ).toBeInTheDocument();
    expect((desktop.officialImport.open as unknown as Mock).mock.calls.length).toBeGreaterThan(1);

    // Signing in again recovers the flow.
    await userEvent.click(screen.getByRole('button', { name: 'I have signed in — Continue' }));
    await screen.findByTestId(`import-application-${APPLICATION.id}`);
  });

  it('NOT_SIGNED_IN keeps the user on sign-in without closing the portal window', async () => {
    const desktop = installDesktopMock();
    desktop.officialImport.list = vi
      .fn()
      .mockRejectedValueOnce(bridgeError('NOT_SIGNED_IN', 'not signed in'))
      .mockResolvedValueOnce([APPLICATION]);
    renderDialog();

    await reachSignInStep();
    await userEvent.click(screen.getByRole('button', { name: 'I have signed in — Continue' }));

    await screen.findByText('Sign in on the official portal first, then click Continue.');
    // Still on the sign-in step; the portal window was focused, never closed.
    expect(
      screen.getByRole('button', { name: 'I have signed in — Continue' }),
    ).toBeInTheDocument();
    expect(desktop.officialImport.close).not.toHaveBeenCalled();
    expect((desktop.officialImport.open as unknown as Mock).mock.calls.length).toBeGreaterThan(1);

    await userEvent.click(screen.getByRole('button', { name: 'I have signed in — Continue' }));
    await screen.findByTestId(`import-application-${APPLICATION.id}`);
  });

  it('blocks confirm on a duplicate until the override checkbox is ticked', async () => {
    const desktop = installDesktopMock();
    desktop.officialImport.list = vi.fn().mockResolvedValue([APPLICATION]);
    desktop.officialImport.get = vi.fn().mockResolvedValue(OFFICIAL_DETAIL);
    desktop.clients.importPreview = vi.fn().mockResolvedValue({
      ...PREVIEW,
      duplicate: { client_id: 7, full_name: 'Ram Sharma' },
    });
    desktop.clients.importConfirm = vi.fn().mockResolvedValue(CONFIRM_RESULT);
    renderDialog();

    await reachSignInStep();
    await userEvent.click(screen.getByRole('button', { name: 'I have signed in — Continue' }));
    await userEvent.click(await screen.findByTestId(`import-application-${APPLICATION.id}`));
    await userEvent.click(screen.getByTestId('import-select-continue'));

    await screen.findByTestId('import-duplicate-banner');
    const createButton = screen.getByTestId('import-confirm-create');
    expect(createButton).toBeDisabled();

    await userEvent.click(
      screen.getByLabelText('Import anyway — I reviewed the possible duplicate'),
    );
    expect(createButton).toBeEnabled();

    await userEvent.click(createButton);
    await screen.findByText('Client created as Fresh');
    const confirmInput = (desktop.clients.importConfirm as unknown as Mock).mock.calls[0][0];
    expect(confirmInput.allow_duplicate).toBe(true);
  });

  it('shows a closed-portal notice with Retry when the window closes during sign-in', async () => {
    const desktop = installDesktopMock();
    let listener: ((payload: unknown) => void) | undefined;
    desktop.on = vi.fn((channel: string, callback: (payload: unknown) => void) => {
      if (channel === 'official-import-state') listener = callback;
      return () => undefined;
    }) as unknown as typeof desktop.on;
    renderDialog();

    await reachSignInStep();
    expect(listener).toBeDefined();

    act(() => {
      listener?.({ type: 'official-import-state', state: 'closed' });
    });

    await screen.findByText('The official portal window was closed. Re-open it to continue.');
    const openCallsBefore = (desktop.officialImport.open as unknown as Mock).mock.calls.length;

    await userEvent.click(screen.getByTestId('import-portal-retry'));
    await waitFor(() => {
      expect((desktop.officialImport.open as unknown as Mock).mock.calls.length).toBeGreaterThan(
        openCallsBefore,
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('import-portal-closed')).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: 'I have signed in — Continue' }),
    ).toBeInTheDocument();
  });

  it('supports manual WPT ID entry and rejects invalid IDs client-side', async () => {
    const desktop = installDesktopMock();
    desktop.officialImport.list = vi.fn().mockResolvedValue([]);
    desktop.officialImport.get = vi.fn().mockResolvedValue(OFFICIAL_DETAIL);
    desktop.clients.importPreview = vi.fn().mockResolvedValue(PREVIEW);
    renderDialog();

    await reachSignInStep();
    await userEvent.click(screen.getByRole('button', { name: 'I have signed in — Continue' }));
    await screen.findByText('No applications found');

    const manualInput = screen.getByTestId('import-manual-id');
    await userEvent.type(manualInput, 'NOT-AN-ID');
    await userEvent.click(screen.getByTestId('import-select-continue'));
    await screen.findByText('Enter a valid application ID, e.g. WPT-1234567');
    expect(desktop.officialImport.get).not.toHaveBeenCalled();

    await userEvent.clear(manualInput);
    await userEvent.type(manualInput, 'WPT-998877');
    await userEvent.click(screen.getByTestId('import-select-continue'));

    await screen.findByTestId('import-review');
    expect(desktop.officialImport.get).toHaveBeenCalledWith('WPT-998877');
  });

  it('stays on review with the error visible when confirm fails validation', async () => {
    const desktop = installDesktopMock();
    desktop.officialImport.list = vi.fn().mockResolvedValue([APPLICATION]);
    desktop.officialImport.get = vi.fn().mockResolvedValue(OFFICIAL_DETAIL);
    desktop.clients.importPreview = vi.fn().mockResolvedValue(PREVIEW);
    desktop.clients.importConfirm = vi
      .fn()
      .mockRejectedValue(bridgeError('VALIDATION_ERROR', 'Phone number is invalid'));
    renderDialog();

    await reachReviewStep();
    await userEvent.click(screen.getByTestId('import-confirm-create'));

    // Back on the review step with the server message surfaced.
    await screen.findByTestId('import-review');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Phone number is invalid');
    expect(screen.getByText('Ready for review…')).toBeInTheDocument();
  });
});
