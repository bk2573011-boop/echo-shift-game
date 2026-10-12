# ECHO SHIFT deployment preparation

## Recommended first release

Use one Render **Web Service** for both the built Vite frontend and the Socket.IO server. The Node server serves `dist/` in production and hosts Socket.IO at `/socket.io` on the same origin. The browser client already uses `io()` without a hard-coded URL, so HTTPS pages automatically connect back to their own host; the Vite proxy remains a local-development setting.

This is the smallest setup because it needs one service, one public URL, and no separate frontend/backend URL synchronization. Render documents WebSocket support for Web Services and requires the app to bind to `0.0.0.0` and its assigned `PORT` ([Web Services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket)).

## Before deploying

The project is connected to the private GitHub repository [bk2573011-boop/echo-shift-game](https://github.com/bk2573011-boop/echo-shift-game), on the `main` branch. Before deployment, connect Render to GitHub and grant its GitHub App access to this private repository. No Render service has been created or deployed yet.

## Render dashboard settings

When you are ready to deploy:

1. In Render, choose **New → Web Service** and connect the ECHO SHIFT repository and branch.
2. Choose the Node runtime and a region near the intended players.
3. Set **Build Command** to `npm ci --include=dev && npm run build`. Including development dependencies ensures Vite is installed even when `NODE_ENV=production` is configured for the service.
4. Set **Start Command** to `npm start`.
5. Set **Health Check Path** to `/health`.
6. Configure these environment variables before creating/deploying the service:

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `SOCKET_ALLOWED_ORIGINS` | The exact public origin, e.g. `https://echo-shift.onrender.com` (no path or trailing slash). Use comma-separated exact origins if using more than one domain. |
   | `PORT` | Leave unset; Render provides the listening port. |

   If Render assigns a different hostname, use that exact URL in `SOCKET_ALLOWED_ORIGINS`. This allowlist protects Socket.IO polling and WebSocket handshakes. It is server-side configuration; no secret or API key belongs in the frontend.

7. Keep the service at one instance. Room and puzzle state is held in server memory; scaling to multiple instances would require shared Socket.IO state/adaptation before it is safe.
8. After deployment, check `https://<service-host>/health`, open the game URL, then create and join a room from two separate browsers/devices.

## Costs and limits

Render's Hobby workspace is currently listed at $0/month, and a Free Web Service is available for hobby testing. Free services sleep after 15 minutes without inbound HTTP/WebSocket traffic and can take about a minute to wake. They have limited compute and may restart; restarts clear all current in-memory rooms. Render describes Free instances as suitable for testing and hobby projects, not production ([free-tier limits](https://render.com/docs/free)).

For an always-on small public release, Render currently lists its smallest paid Web Service at $7/month (0.5 CPU, 512 MB RAM), before any additional usage-based charges ([pricing](https://render.com/pricing)). Review current bandwidth and billing limits before selecting a plan. A paid single instance avoids free-tier sleeping, but rooms still disappear on a server restart or deploy because they are intentionally not persisted.

## Local production-mode smoke test

Run `npm ci --include=dev` and `npm run build`, then set `NODE_ENV=production`, `PORT` to a free local port, and `SOCKET_ALLOWED_ORIGINS` to the matching local origin before running `npm start`. The page, `/health`, and Socket.IO endpoint should all use that same origin. Normal development remains `npm run dev:all`, with Vite's local proxy.
