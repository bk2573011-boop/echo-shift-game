// Production must connect to the exact origin serving the frontend (including a
// Render custom domain). In development, leave the URL unset so Vite's proxy is used.
export function getSocketUrl({ isProduction, pageOrigin }) {
  return isProduction ? pageOrigin : undefined;
}
