
export interface Country {
  code: string;
  name: string;
  dial: string;
  trunk: string;
}

export const COUNTRIES: Country[] = [
  { code: 'ZW', name: 'Zimbabwe', dial: '263', trunk: '0' },
  { code: 'ZA', name: 'South Africa', dial: '27', trunk: '0' },
  { code: 'ZM', name: 'Zambia', dial: '260', trunk: '0' },
  { code: 'MW', name: 'Malawi', dial: '265', trunk: '0' },
  { code: 'MZ', name: 'Mozambique', dial: '258', trunk: '82' },
  { code: 'BW', name: 'Botswana', dial: '267', trunk: '0' },
  { code: 'NA', name: 'Namibia', dial: '264', trunk: '0' },
  { code: 'KE', name: 'Kenya', dial: '254', trunk: '0' },
  { code: 'TZ', name: 'Tanzania', dial: '255', trunk: '0' },
  { code: 'UG', name: 'Uganda', dial: '256', trunk: '0' },
  { code: 'RW', name: 'Rwanda', dial: '250', trunk: '0' },
  { code: 'NG', name: 'Nigeria', dial: '234', trunk: '0' },
  { code: 'GH', name: 'Ghana', dial: '233', trunk: '0' },
  { code: 'EG', name: 'Egypt', dial: '20', trunk: '0' },
  { code: 'ET', name: 'Ethiopia', dial: '251', trunk: '0' },
  { code: 'IN', name: 'India', dial: '91', trunk: '0' },
  { code: 'CN', name: 'China', dial: '86', trunk: '0' },
  { code: 'PH', name: 'Philippines', dial: '63', trunk: '0' },
  { code: 'PK', name: 'Pakistan', dial: '92', trunk: '0' },
  { code: 'BD', name: 'Bangladesh', dial: '880', trunk: '0' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971', trunk: '0' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966', trunk: '0' },
  { code: 'QA', name: 'Qatar', dial: '974', trunk: '0' },
  { code: 'GB', name: 'United Kingdom', dial: '44', trunk: '0' },
  { code: 'IE', name: 'Ireland', dial: '353', trunk: '0' },
  { code: 'US', name: 'United States', dial: '1', trunk: '1' },
  { code: 'CA', name: 'Canada', dial: '1', trunk: '1' },
  { code: 'AU', name: 'Australia', dial: '61', trunk: '0' },
  { code: 'NZ', name: 'New Zealand', dial: '64', trunk: '0' },
  { code: 'DE', name: 'Germany', dial: '49', trunk: '0' },
  { code: 'FR', name: 'France', dial: '33', trunk: '0' },
  { code: 'IT', name: 'Italy', dial: '39', trunk: '0' },
  { code: 'ES', name: 'Spain', dial: '34', trunk: '0' },
  { code: 'NL', name: 'Netherlands', dial: '31', trunk: '0' },
  { code: 'BE', name: 'Belgium', dial: '32', trunk: '0' },
  { code: 'CH', name: 'Switzerland', dial: '41', trunk: '0' },
  { code: 'SE', name: 'Sweden', dial: '46', trunk: '0' },
  { code: 'NO', name: 'Norway', dial: '47', trunk: '0' },
  { code: 'BR', name: 'Brazil', dial: '55', trunk: '0' },
  { code: 'MX', name: 'Mexico', dial: '52', trunk: '0' },
  { code: 'MY', name: 'Malaysia', dial: '60', trunk: '0' },
  { code: 'SG', name: 'Singapore', dial: '65', trunk: '' },
  { code: 'HK', name: 'Hong Kong', dial: '852', trunk: '' },
  { code: 'JP', name: 'Japan', dial: '81', trunk: '0' },
];

export function findCountry(value: string | undefined | null): Country | undefined {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return undefined;
  return COUNTRIES.find((c) => c.name.toLowerCase() === v || c.code.toLowerCase() === v);
}

export interface NormalizedPhone {
  e164: string;
  digits: string;
}

export function normalizePhone(raw: string, countryHint?: string | null): NormalizedPhone | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || !/[0-9]/.test(trimmed)) return null;

  if (/[^0-9+\s\-().]/.test(trimmed)) return null;
  if ((trimmed.match(/\+/g) ?? []).length > 1) return null;

  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  let national = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) national = national.slice(2);

  let e164: string;
  if (international) {
    if (national.length < 8 || national.length > 15) return null;
    e164 = `+${national}`;
  } else {
    const country = findCountry(countryHint);
    if (country) {
      if (national.startsWith(country.dial) && national.length >= 8) {
        e164 = `+${national}`;
      } else {
        const local = national.startsWith(country.trunk) && country.trunk
          ? national.slice(country.trunk.length)
          : national;
        if (!local || local.length < 5) return null;
        e164 = `+${country.dial}${local}`;
      }
    } else {
      const match = COUNTRIES.filter((c) => national.startsWith(c.dial)).sort(
        (a, b) => b.dial.length - a.dial.length,
      )[0];
      if (!match) return null;
      e164 = `+${national}`;
    }
  }

  const digits = e164.slice(1);
  if (digits.length < 8 || digits.length > 15) return null;
  return { e164, digits };
}

export function e164Digits(e164: string): string {
  return e164.replace(/\D/g, '');
}
