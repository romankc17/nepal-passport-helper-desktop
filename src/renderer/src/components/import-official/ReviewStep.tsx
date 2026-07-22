import { useMemo } from 'react';
import type { ImportPreviewResult, ImportWarning } from '../../../../shared/types';
import { Badge } from '../Badge';
import { Checkbox } from '../Checkbox';
import { Input } from '../Input';
import { Label } from '../Label';
import { LocationCascade, type LocationSelection } from '../LocationCascade';
import { Select } from '../Select';

export type ImportFields = Record<string, string>;

interface FieldDef {
  name: string;
  label: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'X', label: 'Other' },
];

export const APPLICATION_TYPE_OPTIONS = [
  { value: 'NEW', label: 'First issuance (new)' },
  { value: 'RENEW', label: 'Passport renewal' },
  { value: 'REPLACE_LOST', label: 'Replacement (lost/stolen)' },
  { value: 'REPLACE_DAMAGED', label: 'Replacement (damaged)' },
  { value: 'MODIFICATION', label: 'Modification' },
];

const PERSONAL_FIELDS: FieldDef[] = [
  { name: 'given_name', label: 'Given name' },
  { name: 'surname', label: 'Surname' },
  { name: 'date_of_birth', label: 'Date of birth (AD)', placeholder: 'YYYY-MM-DD' },
  { name: 'date_of_birth_bs', label: 'Date of birth (BS)' },
  { name: 'nationality', label: 'Nationality' },
  { name: 'national_id_number', label: 'National ID number' },
  { name: 'citizenship_number', label: 'Citizenship number' },
  { name: 'citizenship_issue_date_bs', label: 'Citizenship issue date (BS)' },
  { name: 'citizenship_issue_place', label: 'Citizenship issue place' },
  { name: 'birth_country', label: 'Birth country' },
  { name: 'birth_district', label: 'Birth district' },
];

const CONTACT_FIELDS: FieldDef[] = [
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email' },
  { name: 'address_province', label: 'Province' },
  { name: 'address_district', label: 'District' },
  { name: 'address_municipality', label: 'Municipality' },
  { name: 'address_ward', label: 'Ward' },
  { name: 'address_street', label: 'Street' },
];

const FAMILY_FIELDS: FieldDef[] = [
  { name: 'father_given_name', label: "Father's given name" },
  { name: 'father_surname', label: "Father's surname" },
  { name: 'mother_given_name', label: "Mother's given name" },
  { name: 'mother_surname', label: "Mother's surname" },
];

const APPLICATION_FIELDS: FieldDef[] = [
  { name: 'document_subtype', label: 'Document subtype' },
  { name: 'ordinary_type', label: 'Ordinary type' },
];

const REPLACEMENT_TYPES = new Set(['RENEW', 'REPLACE_LOST', 'REPLACE_DAMAGED']);

function humanize(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface ReviewStepProps {
  /** Parent dialog open + on this step (gates LocationCascade fetching). */
  active: boolean;
  preview: ImportPreviewResult;
  fields: ImportFields;
  onFieldsChange: (fields: ImportFields) => void;
  /** Server-side validation messages keyed by field name (from a failed confirm). */
  fieldErrors: Record<string, string>;
  duplicateRequired: boolean;
  allowDuplicate: boolean;
  onAllowDuplicateChange: (allow: boolean) => void;
}

export function ReviewStep({
  active,
  preview,
  fields,
  onFieldsChange,
  fieldErrors,
  duplicateRequired,
  allowDuplicate,
  onAllowDuplicateChange,
}: ReviewStepProps) {
  const warningsByField = useMemo(() => {
    const map = new Map<string, ImportWarning[]>();
    for (const warning of preview.warnings) {
      const list = map.get(warning.field) ?? [];
      list.push(warning);
      map.set(warning.field, list);
    }
    return map;
  }, [preview.warnings]);

  const applicationType = fields.application_type ?? '';
  const showPrevious = REPLACEMENT_TYPES.has(applicationType);
  const showLost = applicationType === 'REPLACE_LOST';

  const conditionalDefs: FieldDef[] = useMemo(() => {
    const defs: FieldDef[] = [];
    if (showPrevious) {
      for (const key of Object.keys(fields)) {
        if (key.startsWith('previous')) defs.push({ name: key, label: humanize(key) });
      }
    }
    if (showLost) {
      for (const key of Object.keys(fields)) {
        if (key.startsWith('lost_')) defs.push({ name: key, label: humanize(key) });
      }
    }
    return defs.sort((a, b) => a.name.localeCompare(b.name));
  }, [fields, showPrevious, showLost]);

  const setField = (name: string, value: string) => {
    onFieldsChange({ ...fields, [name]: value });
  };

  const locationValue: LocationSelection = {
    provinceId: fields.appointment_province_id ?? '',
    districtId: fields.appointment_district_id ?? '',
    providerId: fields.appointment_provider_id ?? '',
    providerName: '',
    districtName: '',
  };

  const renderField = (def: FieldDef) => {
    if (!(def.name in fields)) return null;
    const warnings = warningsByField.get(def.name) ?? [];
    const error = fieldErrors[def.name];
    return (
      <div key={def.name}>
        <Label htmlFor={`import-field-${def.name}`}>{def.label}</Label>
        <Input
          id={`import-field-${def.name}`}
          data-testid={`import-field-${def.name}`}
          value={fields[def.name] ?? ''}
          placeholder={def.placeholder}
          onChange={(event) => setField(def.name, event.target.value)}
        />
        {warnings.map((warning, index) => (
          <p key={index} className="mt-1 text-xs text-amber-800">
            <Badge tone="amber">check</Badge>{' '}
            {warning.reason}
            {warning.source_value ? ` (portal value: ${warning.source_value})` : ''}
          </p>
        ))}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    );
  };

  const renderSelect = (name: string, label: string, options: { value: string; label: string }[]) => {
    const warnings = warningsByField.get(name) ?? [];
    const error = fieldErrors[name];
    return (
      <div>
        <Label htmlFor={`import-field-${name}`}>{label}</Label>
        <Select
          ariaLabel={label}
          value={fields[name] ?? ''}
          onValueChange={(value) => setField(name, value)}
          options={options}
          placeholder="Select…"
        />
        {warnings.map((warning, index) => (
          <p key={index} className="mt-1 text-xs text-amber-800">
            <Badge tone="amber">check</Badge>{' '}
            {warning.reason}
            {warning.source_value ? ` (portal value: ${warning.source_value})` : ''}
          </p>
        ))}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    );
  };

  const unmappedEntries = Object.entries(preview.unmapped);

  return (
    <div className="flex flex-col gap-5" data-testid="import-review">
      {(duplicateRequired || preview.duplicate) && (
        <div
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
          data-testid="import-duplicate-banner"
        >
          <p className="font-medium">
            Possible duplicate client
            {preview.duplicate
              ? ` — matches existing client ${preview.duplicate.full_name} (#${preview.duplicate.client_id})`
              : ''}
            .
          </p>
          <p className="mt-1">
            A client with the same citizenship number and date of birth already exists.
          </p>
          <label className="mt-2 flex items-center gap-2">
            <Checkbox
              ariaLabel="Import anyway — I reviewed the possible duplicate"
              checked={allowDuplicate}
              onCheckedChange={onAllowDuplicateChange}
            />
            <span>Import anyway — I reviewed the possible duplicate</span>
          </label>
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Personal</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {renderSelect('gender', 'Gender', GENDER_OPTIONS)}
          {PERSONAL_FIELDS.map(renderField)}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Contact &amp; address</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {CONTACT_FIELDS.map(renderField)}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Family</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{FAMILY_FIELDS.map(renderField)}</div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Application</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {renderSelect('application_type', 'Application type', APPLICATION_TYPE_OPTIONS)}
          {APPLICATION_FIELDS.map(renderField)}
          {conditionalDefs.map(renderField)}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Appointment</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {'appointment_country_id' in fields && (
            <div>
              <Label htmlFor="import-field-appointment_country_id">Appointment country (ID)</Label>
              <Input
                id="import-field-appointment_country_id"
                data-testid="import-field-appointment_country_id"
                value={fields.appointment_country_id ?? ''}
                onChange={(event) => setField('appointment_country_id', event.target.value)}
              />
            </div>
          )}
          <LocationCascade
            enabled={active}
            value={locationValue}
            onChange={(next) =>
              onFieldsChange({
                ...fields,
                appointment_province_id: next.provinceId,
                appointment_district_id: next.districtId,
                appointment_provider_id: next.providerId,
              })
            }
            idPrefix="import-appointment"
          />
        </div>
      </section>

      {preview.requirements.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            Documents you&apos;ll need to upload after import
          </h3>
          <ul className="flex flex-col gap-1.5">
            {preview.requirements.map((doc) => (
              <li key={doc.type} className="flex items-center gap-2 text-sm">
                <Checkbox
                  ariaLabel={doc.label}
                  checked={false}
                  disabled
                  onCheckedChange={() => undefined}
                />
                <span className="text-slate-700">{doc.label}</span>
                {doc.required && <Badge tone="red">required</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {unmappedEntries.length > 0 && (
        <details className="rounded-md border border-slate-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-slate-600">
            Values from the portal that were not imported ({unmappedEntries.length})
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
            {unmappedEntries.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="font-mono text-xs text-slate-400">{key}</dt>
                <dd className="text-xs text-slate-600">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
