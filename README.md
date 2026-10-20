# ECHO-SHIFT: THE WORLD REMEMBERS

ECHO-SHIFT is a browser-based 3D puzzle adventure. Play solo or work together with friends to activate switches and relays, open routes, and reach each level's exit.

**Play the live game:** [echo-shift-game.onrender.com](https://echo-shift-game.onrender.com)

## Features

- Three puzzle levels with shared progress in multiplayer rooms.
- Server-simulated movement and puzzle actions.
- Create a room or join one with a six-character room code.
- Rooms support **2–8 players**, with separate player slots and spawn positions.
- Level One uses a switch to open a bridge. Level Two uses two switches in order to activate a timed bridge. Level Three uses cyan, amber, and violet relays in sequence to unlock a bridge.
- Sound can be toggled in the game.

## Requirements

- Node.js **24.21.0**, as specified in `.node-version`.
- npm, included with Node.js.

## Run locally

From the project directory, install dependencies and start the frontend and Socket.IO server together:

```sh
npm ci
npm run dev:all
```

Open the local URL printed by the development command (normally `http://localhost:5173`). The launcher selects another available port if the default is occupied.

To create a production frontend build:

```sh
npm run build
```

Run the project checks with:

```sh
npm run test:config
npm run test:multiplayer
```

## Controls

| Action | Control |
| --- | --- |
| Move | `W`, `A`, `S`, `D` or the arrow keys |
| Jump | `Space` |
| Interact with a nearby switch or relay | `E` |
| Pause or resume | `Escape` |
| Toggle sound | Sound button in the upper-left corner |

## Multiplayer rooms

1. Select **Create Room** in the multiplayer lobby.
2. Share the displayed six-character room code with your group.
3. Other players enter that code in the lobby and select **Join**.

Each room holds up to **8 players**, including its creator. The server rejects joins after the room is full. Room codes use uppercase letters and digits while omitting ambiguous characters. A disconnected player must rejoin manually with the room code. Room progress is held in memory while at least one player remains connected; it is cleared when the last player leaves or the server restarts.

Room codes grant access to a room to anyone who has the code. **They are not user authentication**: the game has no user accounts or per-user identity. Server-side room membership is used to authorize gameplay events.

## Deployment notes

The production configuration and authentication model are documented in [DEPLOYMENT.md](DEPLOYMENT.md). The deployed game is available at [https://echo-shift-game.onrender.com](https://echo-shift-game.onrender.com).
