# ECHO SHIFT deployment preparation

## Recommended first release

Use one Render **Web Service** for both the built Vite frontend and the Socket.IO server. The Node server serves `dist/` in production and hosts Socket.IO at `/socket.io` on the same origin. The browser client already uses `io()` without a hard-coded URL, so HTTPS pages automatically connect back to their own host; the Vite proxy remains a local-development setting.

This is the smallest setup because it needs one service, one public URL, and no separate frontend/backend URL synchronization. Render documents WebSocket support for Web Services and requires the app to bind to `0.0.0.0` and its assigned `PORT` ([Web Services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket)).

## Before deploying

The project is connected to the private GitHub repository [bk2573011-boop/echo-shift-game](https://github.com/bk2573011-boop/echo-shift-game), on the `main` branch. Render needs GitHub App access to this private repository when applying the Blueprint.

## Deploy with the Render Blueprint

The repository includes `render.yaml` for a single Free Web Service. The production client connects to the exact origin serving the page. The server allowlists Render's `RENDER_EXTERNAL_URL` and any exact origins listed in `SOCKET_ALLOWED_ORIGINS`. If you use a custom domain, set `SOCKET_ALLOWED_ORIGINS` in the Render service to the page origin, including scheme (for example, `https://game.example.com`); comma-separate values only if you intentionally serve the game from multiple origins. Do not include a path or trailing slash.

1. Push the Blueprint to the connected Git repository.
2. Open the [Render Blueprint creation page](https://dashboard.render.com/blueprint/new?repo=https://github.com/bk2573011-boop/echo-shift-game), authorize Render's GitHub App for this private repository if prompted, and apply the Blueprint.
3. Keep the service at one instance. Room and puzzle state is held in server memory; scaling to multiple instances would require shared Socket.IO state/adaptation before it is safe.
4. After deployment, check `https://<service-host>/health`, open the game URL, then create a room and join from up to eight separate browsers/devices.

The Blueprint sets `NODE_ENV=production`; Render supplies `PORT` and `RENDER_EXTERNAL_URL` automatically. No application secrets or datastore are required. After a code push, let Render deploy the new commit. If the game uses a custom domain, verify `SOCKET_ALLOWED_ORIGINS` matches that exact domain and restart/redeploy after changing it.

## Authentication and room access

This release has no user accounts, passwords, bearer tokens, or per-user identity. A six-character room code is the admission secret for a room; anyone who obtains it can attempt to join while a seat is available. Codes use cryptographically generated characters from an alphabet that omits ambiguous symbols. The server rejects malformed or nonexistent codes, limits room create/join attempts per socket, and permits **2–8 players per room**. Each player receives a unique slot and a separated spawn position on the current level's starting platform. Players continue to collide with level geometry under the existing server simulation; player avatars do not block one another.

Gameplay events are authorized using server-side socket membership and the player record linked to that socket. Puzzle actions also check pause state, server-simulated position, puzzle sequence/prerequisites, and room state; clients cannot submit coordinates or claim completion directly. Origin allowlisting restricts browser origins but is not user authentication. A disconnect removes that socket's player from the room; reconnecting does not restore identity automatically, and the player must manually rejoin with the room code. Room progress remains in memory only while at least one player remains connected and is lost when the last player leaves or the server restarts.

Required production configuration is `NODE_ENV=production`, the platform-provided `PORT`, and a correct public origin through `RENDER_EXTERNAL_URL` or `SOCKET_ALLOWED_ORIGINS`. For a custom domain, configure `SOCKET_ALLOWED_ORIGINS` as the exact origin (scheme and hostname, no path or trailing slash). There are no application credentials or secret values to provision. Run a single server instance because room state is process-local.

## Costs and limits

Render's Hobby workspace is currently listed at $0/month, and a Free Web Service is available for hobby testing. Free services sleep after 15 minutes without inbound HTTP/WebSocket traffic and can take about a minute to wake. They have limited compute and may restart; restarts clear all current in-memory rooms. Render describes Free instances as suitable for testing and hobby projects, not production ([free-tier limits](https://render.com/docs/free)).

For an always-on small public release, Render currently lists its smallest paid Web Service at $7/month (0.5 CPU, 512 MB RAM), before any additional usage-based charges ([pricing](https://render.com/pricing)). Review current bandwidth and billing limits before selecting a plan. A paid single instance avoids free-tier sleeping, but rooms still disappear on a server restart or deploy because they are intentionally not persisted.

## Local production-mode smoke test

Run `npm ci --include=dev` and `npm run build`, then set `NODE_ENV=production`, `PORT` to a free local port, and `SOCKET_ALLOWED_ORIGINS` to the matching local origin before running `npm start`. The page, `/health`, and Socket.IO endpoint should all use that same origin. Normal development remains `npm run dev:all`, with Vite's local proxy.
