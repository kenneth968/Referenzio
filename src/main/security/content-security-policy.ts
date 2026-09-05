import type { Session } from 'electron';

const policy = (isPackaged: boolean): string => [
  "default-src 'self'",
  isPackaged ? "script-src 'self'" : "script-src 'self' 'unsafe-eval' http://localhost:*",
  isPackaged ? "style-src 'self'" : "style-src 'self' http://localhost:*",
  "img-src 'self' data: blob: referenzio-asset:",
  isPackaged ? "connect-src 'self'" : "connect-src 'self' http://localhost:* ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function installContentSecurityPolicy(session: Pick<Session, 'webRequest'>, isPackaged: boolean): void {
  const value = policy(isPackaged);
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [value] } });
  });
}

export const contentSecurityPolicy = policy;
