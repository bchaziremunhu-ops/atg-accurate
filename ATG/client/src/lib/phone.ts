/**
 * International phone-number normalisation shared by the app and its
 * optional offline/demo mode; mirrors `server/src/lib/phone.ts`.
 */
import { COUNTRIES, findCountry, type CountryOption } from './countries';

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
    const country: CountryOption | undefined = findCountry(countryHint);
    if (country) {
      // A number that already carries the dial code (typed with or without
      // '+') wins over the national interpretation — `26377…` with a Zimbabwe
      // hint must normalise to +26377…, not +263+26377….
      if (national.startsWith(country.dial) && national.length >= 8) {
        e164 = `+${national}`;
      } else {
        const local = national.startsWith(country.trunk) && country.trunk ? national.slice(country.trunk.length) : national;
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
