import type { CookieOptions } from 'express';
import type { ConfigService } from '@nestjs/config';

export const DEFAULT_COOKIE_NAME = 'sunny_session';
export const DEFAULT_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function getCookieName(config: ConfigService): string {
  return config.get<string>('COOKIE_NAME', DEFAULT_COOKIE_NAME);
}

export function getSessionCookieOptions(config: ConfigService): CookieOptions {
  const configuredSecure = config.get<string>('COOKIE_SECURE');
  const configuredMaxAge = config.get<string>('COOKIE_MAX_AGE_MS');
  const maxAge = configuredMaxAge ? Number(configuredMaxAge) : DEFAULT_SESSION_MAX_AGE_MS;

  return {
    httpOnly: true,
    sameSite: 'lax',
    secure:
      configuredSecure === undefined
        ? config.get<string>('NODE_ENV') === 'production'
        : configuredSecure === 'true',
    path: '/',
    maxAge: Number.isFinite(maxAge) ? maxAge : DEFAULT_SESSION_MAX_AGE_MS,
  };
}

export function getClearCookieOptions(config: ConfigService): CookieOptions {
  const options = getSessionCookieOptions(config);
  delete options.maxAge;
  return options;
}
