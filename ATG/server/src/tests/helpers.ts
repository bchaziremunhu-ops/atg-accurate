export function assertIsolatedTestDatabase(): void {
  let databaseName: string;
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is missing.');
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/\/+$/, '').split('/').pop() ?? '');
  } catch {
    throw new Error('Database tests require a valid DATABASE_URL.');
  }
  if (!databaseName.toLowerCase().endsWith('_test')) {
    throw new Error('Refusing to run database tests unless DATABASE_URL names an isolated database ending in _test.');
  }
}

let seq = 0;

export function uniquePhone(): string {
  seq += 1;
  return `+2637${Date.now().toString().slice(-7)}${seq}`;
}

export function uniqueEmail(prefix = 't'): string {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}@test.com`;
}

export interface RegisterOverrides {
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
  nationality?: string;
  dateOfBirth?: string;
  address?: string;
  securityQuestion?: string;
  securityAnswer?: string;
  password?: string;
  confirmPassword?: string;
  acceptTerms?: boolean;
  acceptPrivacy?: boolean;
}

export function registerPayload(overrides: RegisterOverrides = {}) {
  const phone = overrides.phone ?? uniquePhone();
  const password = overrides.password ?? 'Password123!';
  return {
    name: overrides.name ?? 'Test User',
    email: overrides.email ?? uniqueEmail('reg'),
    phone,
    country: overrides.country ?? 'Zimbabwe',
    nationality: overrides.nationality ?? 'Zimbabwe',
    dateOfBirth: overrides.dateOfBirth ?? '1995-06-15',
    address: overrides.address ?? '',
    securityQuestion: overrides.securityQuestion ?? 'city_birth',
    securityAnswer: overrides.securityAnswer ?? 'Harare',
    password,
    confirmPassword: overrides.confirmPassword ?? password,
    acceptTerms: overrides.acceptTerms ?? true,
    acceptPrivacy: overrides.acceptPrivacy ?? true,
  };
}
