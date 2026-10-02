import 'dotenv/config';

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  // Hosts like Render inject PORT; API_PORT is the local-dev name.
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  demoMode: bool(process.env.DEMO_MODE, true),
  debugEndpoints: process.env.NODE_ENV !== 'production' && bool(process.env.DEBUG_ENDPOINTS, true),
  isTest: process.env.VITEST === 'true' || process.env.NODE_ENV === 'test',
};

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
