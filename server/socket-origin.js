function parseOrigins(value = '') {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}


export function getAllowedSocketOrigins({
  isProduction,
  socketAllowedOrigins = '',
  renderExternalUrl = '',
  vitePort = 5173,
}) {
  const origins = [
    ...parseOrigins(socketAllowedOrigins),
    ...(isProduction ? parseOrigins(renderExternalUrl) : []),
    ...(!isProduction ? [`http://localhost:${vitePort}`, `http://127.0.0.1:${vitePort}`] : []),
  ];
  return new Set(origins);
}


export function isAllowedSocketRequest({ origin, host, port, allowedOrigins, secFetchSite }) {
  if (typeof origin === 'string') return allowedOrigins.has(origin);
  if (origin !== undefined) return false;

  // Same-origin GET polling can omit Origin. Require the browser's Fetch Metadata
  // signal and an exact host match against an explicitly allowed website origin.
  if (secFetchSite === 'same-origin') {
    for (const allowedOrigin of allowedOrigins) {
      try {
        if (new URL(allowedOrigin).host === host) return true;
      } catch {
        // Ignore malformed allow-list entries.
      }
    }
  }

  // Vite's local proxy can omit Origin and rewrites Host to this loopback address.
  return host === `127.0.0.1:${port}`;
}
