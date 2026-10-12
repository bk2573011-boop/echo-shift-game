import { randomInt } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const port = Number(process.env.PORT ?? 3001);
const vitePort = Number(process.env.VITE_PORT ?? 5173);
const isProduction = process.env.NODE_ENV === 'production';
const frontendDirectory = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
const roomCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCodeLength = 6;
const maxPlayersPerRoom = 2;
const maxRoomActionsPerMinute = 10;
const maxMovementUpdatesPerSecond = 60;
const playerHeight = 1.25;
const platformTop = -0.025;
const groundCenterY = platformTop + playerHeight / 2;
const movementSpeed = 3.2;
const jumpStrength = 5.2;
const gravity = 14;
const platformRadius = 1.86;
const exitPlatformZ = -8.4;
const exitPlatformRadius = 2.0;
const bridgeCenterZ = -3.9;
const bridgeLength = 5.4;
const exitPortalX = 0;
const exitPortalZ = -9.45;
const exitPortalRadius = 0.9;
const levelTwoX = 24;
const levelTwoSpawn = { x: levelTwoX, y: groundCenterY, z: 0.45 };
const levelTwoPlatforms = [
  { x: levelTwoX, z: 0, radius: 1.72 },
  { x: levelTwoX, z: -3.15, radius: 0.98 },
  { x: levelTwoX, z: -6.2, radius: 1.58 },
  { x: levelTwoX, z: -10.7, radius: 1.78 },
];
const levelTwoSwitches = [
  { x: levelTwoX, z: -0.55 },
  { x: levelTwoX, z: -6.2 },
];
const levelTwoBridgeCenterZ = -8.4;
const levelTwoBridgeLength = 1.8;
const levelTwoBridgeDurationMs = 15_000;
const levelTwoPortalZ = -11.35;
const levelThreeX = 48;
const levelThreeSpawn = { x: levelThreeX, y: groundCenterY, z: 0.45 };
const levelThreePlatforms = [
  { x: levelThreeX, z: 0, radius: 1.72 },
  { x: levelThreeX, z: -3.2, radius: 0.98 },
  { x: levelThreeX, z: -6.4, radius: 0.98 },
  { x: levelThreeX, z: -10.7, radius: 1.78 },
];
const levelThreeRelays = [
  { x: levelThreeX, z: -0.55 },
  { x: levelThreeX, z: -3.2 },
  { x: levelThreeX, z: -6.4 },
];
// The bridge overlaps each neighboring island enough to prevent a player
// falling between surfaces on a fixed-step movement update.
const levelThreeBridgeCenterZ = -8.15;
const levelThreeBridgeLength = 2.6;
const levelThreePortalZ = -11.35;
const inputKeys = ['left', 'right', 'forward', 'backward', 'jump'];
const rooms = new Map();

const allowedOrigins = new Set(
  (process.env.SOCKET_ALLOWED_ORIGINS
    ?? (isProduction ? '' : `http://localhost:${vitePort},http://127.0.0.1:${vitePort}`))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const httpServer = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (isProduction) {
    await serveBuiltFrontend(request, response, pathname);
    return;
  }

  response.writeHead(404);
  response.end('Not found');
});

async function serveBuiltFrontend(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end('Invalid URL path');
    return;
  }

  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  let filePath = resolve(frontendDirectory, `.${requestedPath}`);
  if (filePath !== frontendDirectory && !filePath.startsWith(`${frontendDirectory}${sep}`)) {
    response.writeHead(400);
    response.end('Invalid URL path');
    return;
  }

  try {
    if ((await stat(filePath)).isDirectory()) filePath = resolve(filePath, 'index.html');
    const fileContents = await readFile(filePath);
    const extension = extname(filePath).toLowerCase();
    const cacheControl = requestedPath.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    response.writeHead(200, {
      'Content-Type': contentTypes[extension] ?? 'application/octet-stream',
      'Content-Length': fileContents.length,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : fileContents);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
      console.error(`Could not serve ${requestedPath}: ${error.message}`);
      response.writeHead(500);
      response.end('Unable to load the requested file');
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  }
}

const io = new Server(httpServer, {
  cors: {
    origin: [...allowedOrigins],
    methods: ['GET', 'POST'],
  },
  // CORS alone does not protect WebSocket upgrades. Check the browser origin too.
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    // Same-origin polling GETs may omit Origin. Vite rewrites Host to this exact
    // loopback address, so accept that local proxy path without opening CORS.
    const isTrustedLocalProxy = origin === undefined
      && request.headers.host === `127.0.0.1:${port}`;
    const isAllowedOrigin = typeof origin === 'string' && allowedOrigins.has(origin);
    const isAllowed = isTrustedLocalProxy || isAllowedOrigin;

    if (!isAllowed) {
      console.warn(
        `Rejected Socket.IO connection: origin=${origin ?? '(missing)'}, host=${request.headers.host ?? '(missing)'}`,
      );
    }

    callback(null, isAllowed);
  },
  maxHttpBufferSize: 16 * 1024,
});

function createRoomCode() {
  let code;
  do {
    code = Array.from(
      { length: roomCodeLength },
      () => roomCodeAlphabet[randomInt(roomCodeAlphabet.length)],
    ).join('');
  } while (rooms.has(code));

  return code;
}

function isAcknowledgement(callback) {
  return typeof callback === 'function';
}

function allowRoomAction(socket) {
  const now = Date.now();
  const recentActions = (socket.data.roomActionTimes ?? [])
    .filter((time) => now - time < 60_000);

  if (recentActions.length >= maxRoomActionsPerMinute) {
    socket.data.roomActionTimes = recentActions;
    return false;
  }

  recentActions.push(now);
  socket.data.roomActionTimes = recentActions;
  return true;
}

function emitRoomSummary(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  io.to(roomCode).emit('room:players', {
    roomCode,
    playerCount: room.players.length,
    maxPlayers: maxPlayersPerRoom,
  });
}

function emitRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  io.to(roomCode).emit('room:state', {
    roomCode,
    bridgeActivated: room.bridgeActivated,
    levelComplete: room.levelComplete,
    activeLevel: room.activeLevel,
    levelTwoSwitches: [...room.levelTwoSwitches],
    levelTwoBridgeEndsAt: room.levelTwoBridgeEndsAt,
    levelThreeProgress: room.levelThreeProgress,
    levelThreeBridgeActivated: room.levelThreeBridgeActivated,
    players: room.players.map((player) => ({
      slot: player.slot,
      x: player.x,
      y: player.y,
      z: player.z,
      rotationY: player.rotationY,
    })),
  });
}

function getRoomState(room) {
  return {
    bridgeActivated: room.bridgeActivated,
    levelComplete: room.levelComplete,
    activeLevel: room.activeLevel,
    levelTwoSwitches: [...room.levelTwoSwitches],
    levelTwoBridgeEndsAt: room.levelTwoBridgeEndsAt,
    levelThreeProgress: room.levelThreeProgress,
    levelThreeBridgeActivated: room.levelThreeBridgeActivated,
    players: room.players.map((player) => ({
      slot: player.slot,
      x: player.x,
      y: player.y,
      z: player.z,
      rotationY: player.rotationY,
    })),
  };
}

function createPlayer(slot, socketId) {
  return {
    socketId,
    slot,
    x: slot === 1 ? 0.95 : -0.95,
    y: groundCenterY,
    z: 1.05,
    rotationY: 0,
    verticalVelocity: 0,
    jumpRequested: false,
    paused: false,
    input: { left: false, right: false, forward: false, backward: false, jump: false },
    movementUpdateTimes: [],
  };
}

function movePlayerToLevel(player, level) {
  const levelSpawn = level === 3 ? levelThreeSpawn : level === 2 ? levelTwoSpawn : null;
  const spawn = levelSpawn
    ? { ...levelSpawn, x: levelSpawn.x + (player.slot === 1 ? -0.42 : 0.42) }
    : { x: player.slot === 1 ? 0.95 : -0.95, y: groundCenterY, z: 1.05 };
  player.x = spawn.x;
  player.y = spawn.y;
  player.z = spawn.z;
  player.verticalVelocity = 0;
  player.jumpRequested = false;
}

function isLevelTwoBridgeActive(room) {
  return room.levelTwoBridgeEndsAt > Date.now();
}

function isOnWalkableSurface(room, x, z) {
  if (room.activeLevel === 2) {
    const onIsland = levelTwoPlatforms.some((platform) =>
      Math.hypot(x - platform.x, z - platform.z) <= platform.radius);
    const onTimedBridge = isLevelTwoBridgeActive(room)
      && Math.abs(x - levelTwoX) <= 1.0
      && z >= levelTwoBridgeCenterZ - levelTwoBridgeLength / 2
      && z <= levelTwoBridgeCenterZ + levelTwoBridgeLength / 2;
    return onIsland || onTimedBridge;
  }

  if (room.activeLevel === 3) {
    const onIsland = levelThreePlatforms.some((platform) =>
      Math.hypot(x - platform.x, z - platform.z) <= platform.radius);
    const onUnlockedBridge = room.levelThreeBridgeActivated
      && Math.abs(x - levelThreeX) <= 1.0
      && z >= levelThreeBridgeCenterZ - levelThreeBridgeLength / 2
      && z <= levelThreeBridgeCenterZ + levelThreeBridgeLength / 2;
    return onIsland || onUnlockedBridge;
  }

  const onStartingPlatform = Math.hypot(x, z) <= platformRadius;
  const onExitPlatform = Math.hypot(x, z - exitPlatformZ) <= exitPlatformRadius;
  const onBridge = room.bridgeActivated
    && Math.abs(x) <= 1.02
    && z >= bridgeCenterZ - bridgeLength / 2
    && z <= bridgeCenterZ + bridgeLength / 2;

  return onStartingPlatform || onExitPlatform || onBridge;
}

function isValidMovementInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const keys = Object.keys(input);
  return keys.length === inputKeys.length
    && inputKeys.every((key) => keys.includes(key) && typeof input[key] === 'boolean');
}

function allowMovementUpdate(player) {
  const now = Date.now();
  player.movementUpdateTimes = player.movementUpdateTimes
    .filter((time) => now - time < 1000);
  if (player.movementUpdateTimes.length >= maxMovementUpdatesPerSecond) return false;
  player.movementUpdateTimes.push(now);
  return true;
}

function updatePlayer(room, player, delta) {
  if (player.paused) return;

  const wasGrounded = player.y <= groundCenterY + 0.001
    && isOnWalkableSurface(room, player.x, player.z);
  let moveX = Number(player.input.right) - Number(player.input.left);
  let moveZ = Number(player.input.backward) - Number(player.input.forward);
  const moveLength = Math.hypot(moveX, moveZ);

  if (moveLength > 0) {
    moveX /= moveLength;
    moveZ /= moveLength;
    player.x += moveX * movementSpeed * delta;
    player.z += moveZ * movementSpeed * delta;
    player.rotationY = Math.atan2(moveX, moveZ);
  }

  if (player.jumpRequested && wasGrounded) {
    player.verticalVelocity = jumpStrength;
  }
  player.jumpRequested = false;

  const previousY = player.y;
  player.verticalVelocity -= gravity * delta;
  player.y += player.verticalVelocity * delta;

  if (
    player.verticalVelocity <= 0
    && previousY >= groundCenterY
    && player.y <= groundCenterY
    && isOnWalkableSurface(room, player.x, player.z)
  ) {
    player.y = groundCenterY;
    player.verticalVelocity = 0;
  }

  if (player.y < -8) {
    movePlayerToLevel(player, room.activeLevel);
  }
}

setInterval(() => {
  const fixedDelta = 1 / 20;
  for (const [roomCode, room] of rooms) {
    room.players.forEach((player) => updatePlayer(room, player, fixedDelta));
    emitRoomState(roomCode);
  }
}, 50).unref();

function addPlayerToRoom(socket, roomCode, room) {
  const usedSlots = new Set(room.players.map((player) => player.slot));
  const slot = [1, 2].find((candidate) => !usedSlots.has(candidate));

  const player = createPlayer(slot, socket.id);
  movePlayerToLevel(player, room.activeLevel);
  room.players.push(player);
  socket.data.roomCode = roomCode;
  socket.data.playerSlot = slot;
  socket.join(roomCode);
  emitRoomSummary(roomCode);
  emitRoomState(roomCode);

  return slot;
}

function removePlayerFromRoom(socket) {
  const roomCode = socket.data.roomCode;
  const room = rooms.get(roomCode);
  if (!room) return null;

  room.players = room.players.filter((player) => player.socketId !== socket.id);
  socket.data.roomCode = undefined;
  socket.data.playerSlot = undefined;
  socket.leave(roomCode);

  if (room.players.length === 0) {
    rooms.delete(roomCode);
  } else {
    emitRoomSummary(roomCode);
    emitRoomState(roomCode);
  }

  return { roomCode, playerCount: room.players.length };
}

io.on('connection', (socket) => {
  socket.data.roomActionTimes = [];

  socket.on('room:create', (_request, acknowledge) => {
    if (!isAcknowledgement(acknowledge)) return;
    if (!allowRoomAction(socket)) {
      acknowledge({ ok: false, code: 'rate-limited' });
      return;
    }
    if (socket.data.roomCode) {
      acknowledge({ ok: false, code: 'already-in-room' });
      return;
    }

    const roomCode = createRoomCode();
    const room = {
      players: [], bridgeActivated: false, levelComplete: false,
      activeLevel: 1, levelTwoSwitches: [false, false], levelTwoBridgeEndsAt: 0,
      levelThreeProgress: 0, levelThreeBridgeActivated: false,
    };
    rooms.set(roomCode, room);
    const playerSlot = addPlayerToRoom(socket, roomCode, room);

    acknowledge({
      ok: true,
      roomCode,
      playerSlot,
      playerCount: room.players.length,
      ...getRoomState(room),
    });
  });

  socket.on('room:join', (request, acknowledge) => {
    if (!isAcknowledgement(acknowledge)) return;
    if (!allowRoomAction(socket)) {
      acknowledge({ ok: false, code: 'rate-limited' });
      return;
    }
    if (socket.data.roomCode) {
      acknowledge({ ok: false, code: 'already-in-room' });
      return;
    }

    const rawCode = request && typeof request === 'object' && !Array.isArray(request)
      ? request.roomCode
      : null;
    if (typeof rawCode !== 'string') {
      acknowledge({ ok: false, code: 'invalid-code' });
      return;
    }

    const roomCode = rawCode.trim().toUpperCase();
    const validCode = new RegExp(`^[${roomCodeAlphabet}]{${roomCodeLength}}$`);
    if (!validCode.test(roomCode)) {
      acknowledge({ ok: false, code: 'invalid-code' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      acknowledge({ ok: false, code: 'room-not-found' });
      return;
    }
    if (room.players.length >= maxPlayersPerRoom) {
      acknowledge({ ok: false, code: 'room-full' });
      return;
    }

    const playerSlot = addPlayerToRoom(socket, roomCode, room);
    acknowledge({
      ok: true,
      roomCode,
      playerSlot,
      playerCount: room.players.length,
      ...getRoomState(room),
    });
  });

  socket.on('room:leave', (acknowledge) => {
    if (!isAcknowledgement(acknowledge)) return;
    const result = removePlayerFromRoom(socket);
    if (!result) {
      acknowledge({ ok: false, code: 'not-in-room' });
      return;
    }
    acknowledge({ ok: true, ...result });
  });

  socket.on('player:input', (input) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const player = room?.players.find((candidate) => candidate.socketId === socket.id);
    if (!player || player.paused || !isValidMovementInput(input) || !allowMovementUpdate(player)) return;

    if (input.jump && !player.input.jump) {
      player.jumpRequested = true;
    }
    player.input = input;
  });

  socket.on('player:set-paused', (isPaused) => {
    if (typeof isPaused !== 'boolean') return;
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const player = room?.players.find((candidate) => candidate.socketId === socket.id);
    if (!player) return;

    player.paused = isPaused;
    player.input = { left: false, right: false, forward: false, backward: false, jump: false };
    player.jumpRequested = false;
  });

  socket.on('puzzle:activate-switch', (request, acknowledge) => {
    if (typeof request === 'function') {
      acknowledge = request;
      request = null;
    }
    if (!isAcknowledgement(acknowledge)) return;

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const player = room?.players.find((candidate) => candidate.socketId === socket.id);
    if (!player) {
      acknowledge({ ok: false, code: 'not-in-room' });
      return;
    }
    if (player.paused) {
      acknowledge({ ok: false, code: 'paused' });
      return;
    }

    const isStanding = Math.abs(player.y - groundCenterY) < 0.2;
    if (room.activeLevel === 2) {
      const switchIndex = request && typeof request === 'object' && !Array.isArray(request)
        ? request.switchIndex
        : null;
      if (switchIndex !== 0 && switchIndex !== 1) {
        acknowledge({ ok: false, code: 'invalid-switch' });
        return;
      }
      const target = levelTwoSwitches[switchIndex];
      const isNearSwitch = Math.hypot(player.x - target.x, player.z - target.z) <= 1.15;
      if (!isNearSwitch || !isStanding) {
        acknowledge({ ok: false, code: 'too-far' });
        return;
      }
      if (switchIndex === 1 && !room.levelTwoSwitches[0]) {
        acknowledge({ ok: false, code: 'wrong-sequence' });
        return;
      }

      if (!room.levelTwoSwitches[switchIndex]) {
        room.levelTwoSwitches[switchIndex] = true;
      }
      if (switchIndex === 1 && !isLevelTwoBridgeActive(room)) {
        // A player can recharge the bridge by revisiting the violet switch after it fades.
        room.levelTwoBridgeEndsAt = Date.now() + levelTwoBridgeDurationMs;
      }
      acknowledge({
        ok: true,
        levelTwoSwitches: [...room.levelTwoSwitches],
        levelTwoBridgeEndsAt: room.levelTwoBridgeEndsAt,
      });
    } else if (room.activeLevel === 3) {
      const relayIndex = request && typeof request === 'object' && !Array.isArray(request)
        ? request.switchIndex
        : null;
      if (!Number.isInteger(relayIndex) || relayIndex < 0 || relayIndex >= levelThreeRelays.length) {
        acknowledge({ ok: false, code: 'invalid-switch' });
        return;
      }
      const relay = levelThreeRelays[relayIndex];
      const isNearRelay = Math.hypot(player.x - relay.x, player.z - relay.z) <= 1.15;
      if (!isNearRelay || !isStanding) {
        acknowledge({ ok: false, code: 'too-far' });
        return;
      }
      if (room.levelThreeBridgeActivated) {
        acknowledge({
          ok: true,
          levelThreeProgress: room.levelThreeProgress,
          levelThreeBridgeActivated: true,
        });
      } else if (relayIndex !== room.levelThreeProgress) {
        room.levelThreeProgress = 0;
        acknowledge({ ok: false, code: 'sequence-reset', levelThreeProgress: 0 });
        emitRoomState(roomCode);
        return;
      } else {
        room.levelThreeProgress += 1;
        room.levelThreeBridgeActivated = room.levelThreeProgress === levelThreeRelays.length;
        acknowledge({
          ok: true,
          levelThreeProgress: room.levelThreeProgress,
          levelThreeBridgeActivated: room.levelThreeBridgeActivated,
        });
      }
    } else {
      const isNearSwitch = Math.hypot(player.x + 0.55, player.z + 1.25) <= 1.15;
      if (room.activeLevel !== 1 || (!room.bridgeActivated && (!isNearSwitch || !isStanding))) {
        acknowledge({ ok: false, code: 'too-far' });
        return;
      }
      room.bridgeActivated = true;
      acknowledge({ ok: true, bridgeActivated: true });
    }
    emitRoomState(roomCode);
  });

  socket.on('puzzle:complete-level', (acknowledge) => {
    if (!isAcknowledgement(acknowledge)) return;

    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const player = room?.players.find((candidate) => candidate.socketId === socket.id);
    if (!player) {
      acknowledge({ ok: false, code: 'not-in-room' });
      return;
    }
    if (player.paused) {
      acknowledge({ ok: false, code: 'paused' });
      return;
    }

    // The server checks its own player position; clients cannot report a fake win.
    const isNearExit = room.activeLevel === 2
      ? Math.hypot(player.x - levelTwoX, player.z - levelTwoPortalZ) <= 0.9
      : room.activeLevel === 3
        ? Math.hypot(player.x - levelThreeX, player.z - levelThreePortalZ) <= 0.9
        : Math.hypot(player.x - exitPortalX, player.z - exitPortalZ) <= exitPortalRadius;
    const isStanding = Math.abs(player.y - groundCenterY) < 0.2
      && isOnWalkableSurface(room, player.x, player.z);
    const hasPuzzlePrerequisites = room.activeLevel === 2
      ? room.levelTwoSwitches.every(Boolean) && isLevelTwoBridgeActive(room)
      : room.activeLevel === 3
        ? room.levelThreeBridgeActivated && room.levelThreeProgress === levelThreeRelays.length
        : room.bridgeActivated;
    if (!room.levelComplete && (!hasPuzzlePrerequisites || !isNearExit || !isStanding)) {
      acknowledge({ ok: false, code: 'too-far' });
      return;
    }

    room.levelComplete = true;
    acknowledge({ ok: true, levelComplete: true });
    emitRoomState(roomCode);
  });

  socket.on('puzzle:advance-level', (acknowledge) => {
    if (!isAcknowledgement(acknowledge)) return;
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const player = room?.players.find((candidate) => candidate.socketId === socket.id);
    if (!room || !player) {
      acknowledge({ ok: false, code: 'not-in-room' });
      return;
    }
    if (player.paused) {
      acknowledge({ ok: false, code: 'paused' });
      return;
    }
    if ((room.activeLevel !== 1 && room.activeLevel !== 2) || !room.levelComplete) {
      acknowledge({ ok: false, code: 'level-not-complete' });
      return;
    }

    room.activeLevel += 1;
    room.levelComplete = false;
    room.bridgeActivated = false;
    room.levelTwoSwitches = [false, false];
    room.levelTwoBridgeEndsAt = 0;
    room.levelThreeProgress = 0;
    room.levelThreeBridgeActivated = false;
    room.players.forEach((player) => movePlayerToLevel(player, room.activeLevel));
    acknowledge({ ok: true, activeLevel: room.activeLevel });
    emitRoomSummary(roomCode);
    emitRoomState(roomCode);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  const boundPort = httpServer.address().port;
  console.log(`ECHO SHIFT room server listening on port ${boundPort}`);
  console.log(`Allowed browser origins: ${[...allowedOrigins].join(', ') || '(none; set SOCKET_ALLOWED_ORIGINS)'}`);
  if (isProduction && allowedOrigins.size === 0) {
    console.warn('Production Socket.IO clients will be rejected until SOCKET_ALLOWED_ORIGINS is configured.');
  }
});
