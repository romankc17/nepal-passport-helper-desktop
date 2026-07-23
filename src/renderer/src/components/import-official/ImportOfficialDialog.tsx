import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  ClientSummary,
  ImportConfirmResult,
  ImportPreviewResult,
  OfficialApplicationSummary,
  SupportingDocument,
} from '../../../../shared/types';
import { describeError, errorCode } from '../../lib/errors';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { EmptyState } from '../EmptyState';
import { Input } from '../Input';
import { Label } from '../Label';
import { Spinner } from '../Spinner';
import { ReviewStep, type ImportFields } from './ReviewStep';
import { Stepper } from './Stepper';

const STEP_LABELS = ['Connect', 'Sign in', 'Select', 'Review', 'Create'];

// Client-side shape check only — main/backend re-validate. Matches the
// ipc-contract `asWptId` validator.
const WPT_ID_PATTERN = /^WPT[A-Z0-9-]{3,32}$/i;

type Step = 1 | 2 | 3 | 4 | 5;

interface ErrorState {
  message: string;
  /** When set, a Retry button re-runs the failed operation. */
  retry: (() => void) | null;
}

type OfficialErrorAction = 'signin' | 'retry' | 'none';

// Distinct, honest messages per official-portal failure — never a generic
// "CAPTCHA failed" blame (we cannot detect CAPTCHA outcomes from here).
function classifyOfficialError(error: unknown): { message: string; action: OfficialErrorAction } {
  switch (errorCode(error)) {
    case 'NOT_SIGNED_IN':
      return {
        message: 'Sign in on the official portal first, then click Continue.',
        action: 'signin',
      };
    case 'SESSION_EXPIRED':
      return {
        message: 'Your official portal session was rejected or expired — please sign in again',
        action: 'signin',
      };
    case 'OFFICIAL_WINDOW_CLOSED':
      return {
        message: 'The official portal window was closed — please sign in again',
        action: 'signin',
      };
    case 'NOT_FOUND':
      return {
        message: 'Application not found — it may not belong to the signed-in account',
        action: 'none',
      };
    case 'UNEXPECTED_RESPONSE':
      return {
        message:
          'The portal returned an unexpected page (possibly maintenance or a CAPTCHA wall) — try again',
        action: 'retry',
      };
    case 'RATE_LIMITED':
    case 'TIMEOUT':
    case 'OFFICIAL_UNAVAILABLE':
      return { message: describeError(error, 'The official portal is unavailable'), action: 'retry' };
    default:
      return { message: describeError(error), action: 'none' };
  }
}

// The preload `call()` rejects with a plain {code, message, retryable} object —
// any extra keys (e.g. a per-field error map) survive the spread, so read them
// defensively and map them back to inputs when present.
function extractFieldErrors(error: unknown): Record<string, string> {
  const raw = (error as { fields?: unknown } | null)?.fields;
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key] = Array.isArray(value) ? value.join(' ') : String(value);
  }
  return result;
}

interface ImportOfficialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (client: ClientSummary) => void;
}

export function ImportOfficialDialog({ open, onOpenChange, onCreated }: ImportOfficialDialogProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [portalOpen, setPortalOpen] = useState(false);
  const [blockedHost, setBlockedHost] = useState<string | null>(null);

  const [applications, setApplications] = useState<OfficialApplicationSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [fields, setFields] = useState<ImportFields>({});
  const [supportingDocuments, setSupportingDocuments] = useState<SupportingDocument[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicateRequired, setDuplicateRequired] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);

  const [result, setResult] = useState<ImportConfirmResult | null>(null);
  const [apiOrigin, setApiOrigin] = useState<string | null>(null);

  // Bumped on cancel/close/step-reset so late async resolutions are ignored.
  const runRef = useRef(0);

  // Reset the whole flow whenever the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    runRef.current += 1;
    setStep(1);
    setBusy(null);
    setErrorState(null);
    setPortalOpen(false);
    setBlockedHost(null);
    setApplications([]);
    setSelectedId('');
    setManualId('');
    setManualError(null);
    setPreview(null);
    setFields({});
    setSupportingDocuments([]);
    setFieldErrors({});
    setDuplicateRequired(false);
    setAllowDuplicate(false);
    setResult(null);
    // The web edit URL is site-relative; the renderer only knows the API
    // origin in dev (settings.apiUrl). In production it stays null and the
    // "Edit in web portal" link is hidden.
    window.desktop.settings
      .get()
      .then((settings) => setApiOrigin(settings.apiUrl))
      .catch(() => setApiOrigin(null));
  }, [open]);

  // Track the official portal window lifecycle.
  useEffect(() => {
    if (!open) return;
    return window.desktop.on('official-import-state', (payload) => {
      if (payload.state === 'blocked-navigation') {
        setBlockedHost(payload.host ?? 'another site');
        return;
      }
      setPortalOpen(payload.state === 'opened');
    });
  }, [open]);

  const closePortal = () => {
    void window.desktop.officialImport.close().catch(() => undefined);
  };

  const requestClose = () => {
    runRef.current += 1;
    closePortal();
    onOpenChange(false);
  };

  const openPortal = async () => {
    const run = ++runRef.current;
    setBusy('Opening official portal…');
    setErrorState(null);
    try {
      await window.desktop.officialImport.open();
      if (run !== runRef.current) return;
      setPortalOpen(true);
      setStep(2);
    } catch (error) {
      if (run !== runRef.current) return;
      setErrorState({ message: describeError(error, 'Could not open the official portal'), retry: () => void openPortal() });
    } finally {
      if (run === runRef.current) setBusy(null);
    }
  };

  // SESSION_EXPIRED / OFFICIAL_WINDOW_CLOSED → back to the sign-in step; the
  // portal window is re-opened (or focused) so the user can sign in again.
  const backToSignIn = (message: string) => {
    setStep(2);
    setErrorState({ message, retry: null });
    window.desktop.officialImport
      .open()
      .then(() => setPortalOpen(true))
      .catch(() => setPortalOpen(false));
  };

  const handleOfficialError = (error: unknown, retry: () => void) => {
    const classified = classifyOfficialError(error);
    if (classified.action === 'signin') {
      backToSignIn(classified.message);
      return;
    }
    setErrorState({
      message: classified.message,
      retry: classified.action === 'retry' ? retry : null,
    });
  };

  const loadApplications = async () => {
    const run = ++runRef.current;
    setStep(3);
    setBusy('Loading your applications…');
    setErrorState(null);
    try {
      const list = await window.desktop.officialImport.list();
      if (run !== runRef.current) return;
      setApplications(list);
      setSelectedId('');
    } catch (error) {
      if (run !== runRef.current) return;
      handleOfficialError(error, () => void loadApplications());
    } finally {
      if (run === runRef.current) setBusy(null);
    }
  };

  // "I have signed in — Continue": verify the official session once. The
  // portal window stays open either way; only a verified session advances.
  const verifyAndLoad = async () => {
    const run = ++runRef.current;
    setBusy('Verifying official session…');
    setErrorState(null);
    try {
      const list = await window.desktop.officialImport.list();
      if (run !== runRef.current) return;
      setApplications(list);
      setSelectedId('');
      setStep(3);
    } catch (error) {
      if (run !== runRef.current) return;
      handleOfficialError(error, () => void verifyAndLoad());
    } finally {
      if (run === runRef.current) setBusy(null);
    }
  };

  const continueWithApplication = async () => {
    const manual = manualId.trim();
    let applicationId = selectedId;
    if (manual) {
      if (!WPT_ID_PATTERN.test(manual)) {
        setManualError('Enter a valid application ID, e.g. WPT-1234567');
        return;
      }
      applicationId = manual;
    }
    if (!applicationId) return;
    setManualError(null);
    const run = ++runRef.current;
    setBusy('Loading application details…');
    setErrorState(null);
    try {
      const { supportingDocumentsData, ...application } =
        await window.desktop.officialImport.get(applicationId);
      if (run !== runRef.current) return;
      setBusy('Mapping fields…');
      // Documents travel separately (to importConfirm) — the preview payload
      // stays small since it only maps application fields.
      const previewResult = await window.desktop.clients.importPreview({ application });
      if (run !== runRef.current) return;
      setPreview(previewResult);
      setFields({ ...previewResult.fields });
      setSupportingDocuments(Array.isArray(supportingDocumentsData) ? supportingDocumentsData : []);
      setFieldErrors({});
      setDuplicateRequired(previewResult.duplicate !== null);
      setAllowDuplicate(false);
      setStep(4);
    } catch (error) {
      if (run !== runRef.current) return;
      handleOfficialError(error, () => void continueWithApplication());
    } finally {
      if (run === runRef.current) setBusy(null);
    }
  };

  const confirmCreate = async () => {
    const run = ++runRef.current;
    setStep(5);
    setBusy('Creating fresh client…');
    setErrorState(null);
    try {
      const confirmResult = await window.desktop.clients.importConfirm({
        fields,
        allow_duplicate: allowDuplicate,
        idempotency_key: window.crypto.randomUUID(),
        supporting_documents: supportingDocuments,
      });
      if (run !== runRef.current) return;
      setResult(confirmResult);
      // Import finished — the portal window is no longer needed.
      closePortal();
    } catch (error) {
      if (run !== runRef.current) return;
      const code = errorCode(error);
      if (code === 'DUPLICATE_CLIENT') {
        setDuplicateRequired(true);
        setStep(4);
        setErrorState({
          message: describeError(error, 'This looks like a duplicate of an existing client'),
          retry: null,
        });
      } else if (code === 'VALIDATION_ERROR') {
        setFieldErrors(extractFieldErrors(error));
        setStep(4);
        setErrorState({
          message: describeError(error, 'Please fix the highlighted fields'),
          retry: null,
        });
      } else {
        setErrorState({ message: describeError(error), retry: () => void confirmCreate() });
      }
    } finally {
      if (run === runRef.current) setBusy(null);
    }
  };

  const finishWithClient = (client: ClientSummary) => {
    runRef.current += 1;
    onOpenChange(false);
    onCreated(client);
  };

  const portalClosedNotice = !portalOpen && !result && step >= 2 && step <= 4;

  const editUrl =
    result && apiOrigin
      ? `${apiOrigin.replace(/\/+$/, '')}${result.edit_url.startsWith('/') ? '' : '/'}${result.edit_url}`
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      title="Import from official application"
      description="Create a Fresh client from an application on the official passport portal."
      className="max-w-3xl"
    >
      <div data-testid="import-official-dialog" className="flex flex-col gap-5">
        <Stepper steps={STEP_LABELS} current={step} />

        {errorState && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <span>{errorState.message}</span>
            {errorState.retry && (
              <Button size="sm" variant="secondary" onClick={errorState.retry}>
                Retry
              </Button>
            )}
          </div>
        )}

        {blockedHost && (
          <div
            className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
            role="status"
            data-testid="import-blocked-navigation"
          >
            The portal tried to navigate to <strong>{blockedHost}</strong>, which is outside the
            official site — blocked for security. If sign-in depends on that page, cancel and
            report it.
          </div>
        )}

        {portalClosedNotice && (
          <div
            className="flex items-start justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
            data-testid="import-portal-closed"
          >
            <span>The official portal window was closed. Re-open it to continue.</span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                data-testid="import-portal-retry"
                loading={busy === 'Opening official portal…'}
                onClick={() => void openPortal()}
              >
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={requestClose}>
                Cancel
              </Button>
            </span>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <ol className="list-inside list-decimal text-sm text-slate-600">
              <li>Open the official passport portal in a separate window.</li>
              <li>Sign in there and solve the CAPTCHA yourself.</li>
              <li>Pick the application to import, review the mapped fields, and create the client.</li>
            </ol>
            <p className="flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              You sign in on the official government portal. This app never sees your password or
              the CAPTCHA.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                data-testid="import-open-portal"
                loading={busy === 'Opening official portal…'}
                onClick={() => void openPortal()}
              >
                Open official portal
              </Button>
            </div>
            {busy === 'Opening official portal…' && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Spinner size="sm" /> Opening official portal…
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <Spinner size="sm" /> Waiting for sign-in and CAPTCHA…
            </p>
            <p className="text-sm text-slate-500">
              Sign in on the official portal window with your own credentials and solve the CAPTCHA
              there. When you can see your applications in that window, come back here and
              continue.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" data-testid="import-cancel" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                data-testid="import-signed-in-continue"
                disabled={portalClosedNotice}
                loading={busy === 'Verifying official session…'}
                onClick={() => void verifyAndLoad()}
              >
                I have signed in — Continue
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            {busy === 'Loading your applications…' ? (
              <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Spinner size="sm" /> Loading your applications…
              </p>
            ) : applications.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No applications found"
                description="The signed-in account has no applications. You can enter an application ID manually below."
              />
            ) : (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-700">
                  Select an application to import
                </legend>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                      <th className="px-2 py-2 font-medium" aria-label="Select" />
                      <th className="px-2 py-2 font-medium">Application ID</th>
                      <th className="px-2 py-2 font-medium">Applicant</th>
                      <th className="px-2 py-2 font-medium">Type</th>
                      <th className="px-2 py-2 font-medium">Submitted</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((application) => (
                      <tr
                        key={application.id}
                        className="border-b border-slate-50 hover:bg-blue-50/40"
                      >
                        <td className="px-2 py-2">
                          <input
                            type="radio"
                            name="official-application"
                            data-testid={`import-application-${application.id}`}
                            aria-label={`Select application ${application.id}`}
                            checked={selectedId === application.id}
                            onChange={() => setSelectedId(application.id)}
                            className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          />
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-slate-600">
                          {application.id}
                        </td>
                        <td className="px-2 py-2 text-slate-800">{application.applicant_name}</td>
                        <td className="px-2 py-2 text-slate-600">{application.application_type}</td>
                        <td className="px-2 py-2 text-slate-600">{application.submitted_at}</td>
                        <td className="px-2 py-2 text-slate-600">{application.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </fieldset>
            )}

            {busy !== 'Loading your applications…' && (
              <details className="rounded-md border border-slate-200 px-3 py-2">
                <summary className="cursor-pointer text-sm text-slate-600">
                  Enter an application ID manually
                </summary>
                <div className="mt-3">
                  <Label htmlFor="import-manual-id">Application ID</Label>
                  <Input
                    id="import-manual-id"
                    data-testid="import-manual-id"
                    placeholder="WPT-1234567"
                    value={manualId}
                    onChange={(event) => {
                      setManualId(event.target.value);
                      setManualError(null);
                    }}
                  />
                  {manualError && <p className="mt-1 text-xs text-danger">{manualError}</p>}
                </div>
              </details>
            )}

            <div className="flex items-center justify-between gap-2">
              <div>
                {busy && busy !== 'Loading your applications…' && (
                  <p className="flex items-center gap-2 text-sm text-slate-500">
                    <Spinner size="sm" /> {busy}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" data-testid="import-cancel" onClick={requestClose}>
                  Cancel
                </Button>
                <Button
                  data-testid="import-select-continue"
                  disabled={(!selectedId && !manualId.trim()) || busy !== null}
                  loading={busy === 'Loading application details…' || busy === 'Mapping fields…'}
                  onClick={() => void continueWithApplication()}
                >
                  Continue
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 4 && preview && (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium text-slate-700">Ready for review…</p>
            <ReviewStep
              active={open && step === 4}
              preview={preview}
              fields={fields}
              onFieldsChange={setFields}
              fieldErrors={fieldErrors}
              duplicateRequired={duplicateRequired}
              allowDuplicate={allowDuplicate}
              onAllowDuplicateChange={setAllowDuplicate}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                data-testid="import-back"
                onClick={() => {
                  setErrorState(null);
                  setStep(3);
                }}
              >
                Back
              </Button>
              <Button variant="ghost" data-testid="import-cancel" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                data-testid="import-confirm-create"
                disabled={duplicateRequired && !allowDuplicate}
                onClick={() => void confirmCreate()}
              >
                Create fresh client
              </Button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-4">
            {result ? (
              <div className="flex flex-col items-start gap-3" data-testid="import-success">
                <p className="text-sm font-semibold text-slate-800">Client created as Fresh</p>
                <p className="text-sm text-slate-600">
                  {result.client.full_name} was imported as a new Fresh client. Upload the required
                  documents before booking.
                </p>
                <div className="flex gap-2">
                  <Button
                    data-testid="import-view-client"
                    onClick={() => finishWithClient(result.client)}
                  >
                    View client
                  </Button>
                  {editUrl && (
                    <a
                      href={editUrl}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="import-edit-portal"
                      className="inline-flex h-10 items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      Edit in web portal
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
                <Spinner size="sm" /> Creating fresh client…
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
