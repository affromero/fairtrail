import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Ensures the self-hosted settings page and admin config page stay in sync.
 * If a field exists in admin config's handleSave, it must also exist in settings.
 * This prevents the bug where currency/country fields were only on the admin page.
 */

const SETTINGS_PAGE = readFileSync(
  resolve(__dirname, '../../app/settings/page.tsx'),
  'utf-8'
);
const ADMIN_CONFIG_PAGE = readFileSync(
  resolve(__dirname, '../../app/admin/(dashboard)/config/page.tsx'),
  'utf-8'
);
const CONFIG_API = readFileSync(
  resolve(__dirname, '../../app/api/admin/config/route.ts'),
  'utf-8'
);

/** Extract Config interface fields from source code */
function extractConfigFields(source: string): string[] {
  const match = source.match(/interface Config \{([^}]+)\}/);
  if (!match?.[1]) return [];
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .map((line) => line.split(':')[0]!.trim())
    .filter(Boolean);
}

/** Extract field names from handleSave JSON.stringify body */
function extractSaveBodyFields(source: string): string[] {
  // Match JSON.stringify({ ... }) in handleSave
  const handleSaveMatch = source.match(
    /handleSave[\s\S]*?JSON\.stringify\(\{([^}]+)\}/
  );
  if (!handleSaveMatch?.[1]) return [];
  return handleSaveMatch[1]
    .split(',')
    .map((field) => {
      const trimmed = field.trim();
      // Handle both "key: value" and "key" (shorthand)
      const colonIdx = trimmed.indexOf(':');
      return colonIdx > 0 ? trimmed.slice(0, colonIdx).trim() : trimmed;
    })
    .filter((f) => f && !f.startsWith('//') && !f.startsWith('\n'));
}

/** Extract PATCH-able fields the API actually accepts */
function extractApiPatchFields(source: string): string[] {
  const fields: string[] = [];
  // Match patterns like: body.fieldName !== undefined, body.fieldName, typeof body.fieldName
  const matches = source.matchAll(/body\.(\w+)/g);
  for (const m of matches) {
    if (m[1] && !fields.includes(m[1])) {
      fields.push(m[1]);
    }
  }
  return fields;
}

describe('settings page parity with admin config', () => {
  it('settings Config interface has all fields from admin Config interface', () => {
    const settingsFields = extractConfigFields(SETTINGS_PAGE);
    const adminFields = extractConfigFields(ADMIN_CONFIG_PAGE);

    // Settings page is a subset of admin (admin has extra fields like hasAdminPassword).
    // But core data fields must exist in both.
    const coreFields = adminFields.filter(
      (f) => !['hasAdminPassword'].includes(f)
    );

    for (const field of coreFields) {
      expect(
        settingsFields,
        `Settings page Config is missing field "${field}" that admin config has`
      ).toContain(field);
    }
  });

  it('settings handleSave sends all data fields that admin handleSave sends', () => {
    const settingsSaveFields = extractSaveBodyFields(SETTINGS_PAGE);
    const adminSaveFields = extractSaveBodyFields(ADMIN_CONFIG_PAGE);

    // Admin page may send additional fields (e.g., adminPassword) that settings doesn't.
    // But all extraction-related fields should be in both.
    const extractionFields = adminSaveFields.filter(
      (f) => !['adminPassword'].includes(f)
    );

    for (const field of extractionFields) {
      expect(
        settingsSaveFields,
        `Settings handleSave is missing field "${field}" that admin handleSave sends`
      ).toContain(field);
    }
  });

  it('API PATCH handler accepts defaultCurrency and defaultCountry', () => {
    const apiFields = extractApiPatchFields(CONFIG_API);

    expect(apiFields).toContain('defaultCurrency');
    expect(apiFields).toContain('defaultCountry');
  });

  it('settings page has useState hooks for defaultCurrency and defaultCountry', () => {
    expect(SETTINGS_PAGE).toContain("const [defaultCurrency, setDefaultCurrency]");
    expect(SETTINGS_PAGE).toContain("const [defaultCountry, setDefaultCountry]");
  });

  it('settings useEffect populates defaultCurrency and defaultCountry from API', () => {
    expect(SETTINGS_PAGE).toContain('setDefaultCurrency(');
    expect(SETTINGS_PAGE).toContain('setDefaultCountry(');
  });

  it('settings page renders input fields for currency and country', () => {
    expect(SETTINGS_PAGE).toContain('Default Currency');
    expect(SETTINGS_PAGE).toContain('Default Country');
    expect(SETTINGS_PAGE).toContain('maxLength={3}');
    expect(SETTINGS_PAGE).toContain('maxLength={2}');
  });
});
