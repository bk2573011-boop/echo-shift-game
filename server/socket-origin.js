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

export function isAllowedSocketRequest({ origin, host, port, allowedOrigins }) {
  // Vite's local proxy can omit Origin and rewrites Host to this loopback address.
  if (origin === undefined && host === `127.0.0.1:${port}`) return true;
  return typeof origin === 'string' && allowedOrigins.has(origin);
}
