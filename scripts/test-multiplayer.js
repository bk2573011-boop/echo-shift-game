import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

// By default, the test starts its own Vite and Socket.IO servers. Set
// ECHO_SHIFT_URL only when intentionally testing an already-running stack.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
let serverUrl = process.env.ECHO_SHIFT_URL ?? null;
const clients = [];
const ownedProcesses = [];
const roomCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findFreePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return port;
}

function startOwnedProcess(label, script, args, env) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { label, child, output: '' };
  child.stdout.on('data', (chunk) => { record.output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { record.output += chunk.toString(); });
  ownedProcesses.push(record);
  return record;
}

async function waitForHttp(record, url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (record.child.exitCode !== null) {
      throw new Error(`${record.label} exited before responding. ${record.output.trim()}`);
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The service may still be starting. Retry until it responds or exits.
    }
    await delay(100);
  }
  throw new Error(`${record.label} did not respond at ${url}. ${record.output.trim()}`);
}

async function startTestServers() {
  const serverPort = await findFreePort();
  let vitePort = await findFreePort();
  while (vitePort === serverPort) vitePort = await findFreePort();

  const server = startOwnedProcess('Socket.IO server', 'server/index.js', [], {
    PORT: String(serverPort),
    VITE_PORT: String(vitePort),
  });
  const vite = startOwnedProcess('Vite server', 'node_modules/vite/bin/vite.js', [
    '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
  ], {
    PORT: String(serverPort),
    VITE_PORT: String(vitePort),
  });

  await Promise.all([
    waitForHttp(server, `http://127.0.0.1:${serverPort}/health`),
    waitForHttp(vite, `http://127.0.0.1:${vitePort}/`),
  ]);
  return `http://127.0.0.1:${vitePort}`;
}

async function stopOwnedProcesses() {
  for (const { child } of [...ownedProcesses].reverse()) {
    if (child.exitCode !== null || child.killed) continue;
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(2000),
    ]);
  }
}

function connectClient(label) {
  const socket = io(serverUrl, {
    forceNew: true,
    reconnection: false,
    timeout: 5000,
  });
  clients.push(socket);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} connection timed out`)), 6000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${label} could not connect: ${error.message}`));
    });
  });
}

function waitFor(socket, eventName, predicate, label, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handleEvent);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    function handleEvent(value) {
      if (!predicate(value)) return;
      clearTimeout(timeout);
      socket.off(eventName, handleEvent);
      resolve(value);
    }

    socket.on(eventName, handleEvent);
  });
}

function request(socket, eventName, payload) {
  return new Promise((resolve, reject) => {
    const callback = (timeoutError, response) => {
      if (timeoutError) {
        reject(new Error(`${eventName} did not receive a server response`));
        return;
      }
      resolve(response);
    };

    const timedSocket = socket.timeout(5000);
    if (payload === undefined) timedSocket.emit(eventName, callback);
    else timedSocket.emit(eventName, payload, callback);
  });
}

function playerAt(state, slot) {
  return state.players.find((player) => player.slot === slot);
}

function sendInput(socket, changes = {}) {
  socket.emit('player:input', {
    left: false,
    right: false,
    forward: false,
    backward: false,
    jump: false,
    ...changes,
  });
}

async function moveToZ(socket, roomCode, slot, targetZ, label, timeoutMs = 8000) {
  const reached = waitFor(
    socket,
    'room:state',
    (state) => state.roomCode === roomCode && playerAt(state, slot).z <= targetZ,
    label,
    timeoutMs,
  );
  sendInput(socket, { forward: true });
  await reached;
  sendInput(socket);
}

async function jumpForwardToZ(socket, roomCode, slot, targetZ, label, timeoutMs = 8000) {
  const landed = waitFor(
    socket,
    'room:state',
    (state) => state.roomCode === roomCode
      && playerAt(state, slot).z <= targetZ
      && Math.abs(playerAt(state, slot).y - 0.6) < 0.02,
    label,
    timeoutMs,
  );
  sendInput(socket, { forward: true, jump: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  sendInput(socket, { forward: true });
  await landed;
  sendInput(socket);
}

function report(message) {
  console.log(`PASS ${message}`);
}

async function waitUntilConnected(socket) {
  if (socket.connected) return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket.IO reconnect timed out')), 6000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function runTests() {
  // Room creation and joining.
  const playerOne = await connectClient('Player 1');
  const created = await request(playerOne, 'room:create', null);
  assert.equal(created.ok, true);
  assert.match(created.roomCode, new RegExp(`^[${roomCodeAlphabet}]{6}$`));
  assert.equal(created.playerCount, 1);

  const playerTwo = await connectClient('Player 2');
  const bothPlayersSummary = waitFor(
    playerOne,
    'room:players',
    (summary) => summary.roomCode === created.roomCode && summary.playerCount === 2,
    'two-player room summary',
  );
  const joined = await request(playerTwo, 'room:join', { roomCode: created.roomCode.toLowerCase() });
  assert.equal(joined.ok, true);
  assert.equal(joined.playerCount, 2);
  await bothPlayersSummary;
  report('two players join one room and both receive 2/2 membership');
  const prematureAdvance = await request(playerOne, 'puzzle:advance-level');
  assert.equal(prematureAdvance.code, 'level-not-complete');
  report('Level 2 transition is rejected until Level 1 is complete');

  // Invalid code, capacity, and room isolation.
  const thirdClient = await connectClient('Third client');
  const invalidCode = await request(thirdClient, 'room:join', { roomCode: '!!!!!!' });
  assert.equal(invalidCode.code, 'invalid-code');
  const otherRoom = await request(thirdClient, 'room:create', null);
  assert.equal(otherRoom.ok, true);
  assert.equal(otherRoom.maxPlayers, 8);
  const duplicateCreate = await request(thirdClient, 'room:create', null);
  assert.equal(duplicateCreate.code, 'already-in-room');
  const roomMembers = [thirdClient];
  const roomSlots = [otherRoom.playerSlot];
  for (let index = 2; index <= 8; index += 1) {
    const member = await connectClient(`Capacity player ${index}`);
    const response = await request(member, 'room:join', { roomCode: otherRoom.roomCode });
    assert.equal(response.ok, true);
    assert.equal(response.playerCount, index);
    assert.equal(response.maxPlayers, 8);
    roomMembers.push(member);
    roomSlots.push(response.playerSlot);
  }
  assert.deepEqual([...roomSlots].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  const duplicateJoin = await request(roomMembers[1], 'room:join', { roomCode: otherRoom.roomCode });
  assert.equal(duplicateJoin.code, 'already-in-room');
  const ninthClient = await connectClient('Ninth player');
  const ninthJoin = await request(ninthClient, 'room:join', { roomCode: otherRoom.roomCode });
  assert.equal(ninthJoin.ok, false);
  assert.equal(ninthJoin.code, 'room-full');
  const leavingSummary = waitFor(thirdClient, 'room:players',
    (summary) => summary.roomCode === otherRoom.roomCode && summary.playerCount === 7,
    'capacity room leave membership update');
  const capacityLeave = await request(roomMembers[7], 'room:leave');
  assert.equal(capacityLeave.ok, true);
  assert.equal(capacityLeave.playerCount, 7);
  await leavingSummary;
  const replacementJoin = await request(ninthClient, 'room:join', { roomCode: otherRoom.roomCode });
  assert.equal(replacementJoin.ok, true);
  assert.equal(replacementJoin.playerCount, 8);
  report('room creation, duplicate requests, 8-player capacity, ninth-player rejection, and leave slot reuse');
  report('invalid code is rejected and an independent room can be created');

  // Server-derived positions and facing directions are shared with both clients.
  const movementPredicate = (state) => {
    if (state.roomCode !== created.roomCode || state.players.length !== 2) return false;
    return playerAt(state, 1).x < 0.8 && playerAt(state, 2).x > -0.8;
  };
  const movementForOne = waitFor(playerOne, 'room:state', movementPredicate, 'Player 1 movement');
  const movementForTwo = waitFor(playerTwo, 'room:state', movementPredicate, 'Player 2 movement');
  sendInput(playerOne, { left: true });
  sendInput(playerTwo, { right: true });
  const [stateOne, stateTwo] = await Promise.all([movementForOne, movementForTwo]);
  sendInput(playerOne);
  sendInput(playerTwo);
  assert.deepEqual(stateOne.players, stateTwo.players);
  assert.ok(Math.abs(playerAt(stateOne, 1).rotationY + Math.PI / 2) < 0.02);
  assert.ok(Math.abs(playerAt(stateOne, 2).rotationY - Math.PI / 2) < 0.02);
  report('independent movement and rotation snapshots match on both clients');

  // The server simulates the jump; clients do not submit a position or velocity.
  const jumpRise = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode && playerAt(state, 1).y > 0.85,
    'jump rise',
  );
  sendInput(playerOne, { jump: true });
  await jumpRise;
  sendInput(playerOne);
  await waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode
      && Math.abs(playerAt(state, 1).y - 0.6) < 0.01,
    'jump landing',
    4000,
  );
  report('jump and landing are simulated and broadcast by the server');

  const beforePause = await waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode,
    'position before per-player pause',
  );
  const pausedPlayerStart = { ...playerAt(beforePause, 1) };
  const activePlayerStart = { ...playerAt(beforePause, 2) };
  playerOne.emit('player:set-paused', true);
  const pausedAndOtherMoving = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode
      && Math.abs(playerAt(state, 1).z - pausedPlayerStart.z) < 0.01
      && playerAt(state, 2).x > activePlayerStart.x + 0.25,
    'one player pauses while the other keeps moving',
    4000,
  );
  sendInput(playerOne, { forward: true });
  sendInput(playerTwo, { right: true });
  const pauseState = await pausedAndOtherMoving;
  assert.ok(Math.abs(playerAt(pauseState, 1).y - pausedPlayerStart.y) < 0.01);
  sendInput(playerTwo);
  playerOne.emit('player:set-paused', false);
  report('server pauses one player in place while the other player continues independently');

  // Unknown coordinate fields and a client-authored position event are ignored.
  const beforeMalformedInput = await waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode,
    'pre-malformed snapshot',
  );
  const beforePosition = playerAt(beforeMalformedInput, 1);
  const afterMalformedInput = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode,
    'post-malformed snapshot',
  );
  playerOne.emit('player:input', {
    left: false, right: false, forward: false, backward: false, jump: false,
    x: 5000, y: 5000, z: 5000,
  });
  playerOne.emit('player:position', { x: 5000, y: 5000, z: 5000 });
  const unchangedState = await afterMalformedInput;
  const unchangedPosition = playerAt(unchangedState, 1);
  assert.ok(Math.abs(unchangedPosition.x - beforePosition.x) < 0.01);
  assert.ok(Math.abs(unchangedPosition.y - beforePosition.y) < 0.01);
  assert.ok(Math.abs(unchangedPosition.z - beforePosition.z) < 0.01);
  report('malformed input and client-supplied coordinates do not alter server state');

  // A player must stand near the switch; successful activation is room-scoped.
  const distantActivation = await request(playerOne, 'puzzle:activate-switch');
  assert.equal(distantActivation.code, 'too-far');

  const nearSwitchX = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode && playerAt(state, 1).x < -0.3,
    'move beside switch on x axis',
  );
  sendInput(playerOne, { left: true });
  await nearSwitchX;
  sendInput(playerOne);

  const nearSwitchZ = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode && playerAt(state, 1).z < -0.55,
    'move beside switch on z axis',
  );
  sendInput(playerOne, { forward: true });
  await nearSwitchZ;
  sendInput(playerOne);

  playerOne.emit('player:set-paused', true);
  const pausedSwitch = await request(playerOne, 'puzzle:activate-switch');
  assert.equal(pausedSwitch.ok, false);
  assert.equal(pausedSwitch.code, 'paused');
  playerOne.emit('player:set-paused', false);

  const bridgeOnOne = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode && state.bridgeActivated,
    'bridge activation for Player 1',
  );
  const bridgeOnTwo = waitFor(
    playerTwo,
    'room:state',
    (state) => state.roomCode === created.roomCode && state.bridgeActivated,
    'bridge activation for Player 2',
  );
  const activation = await request(playerOne, 'puzzle:activate-switch');
  assert.equal(activation.ok, true);
  const [activatedOne, activatedTwo] = await Promise.all([bridgeOnOne, bridgeOnTwo]);
  assert.equal(activatedOne.bridgeActivated, true);
  assert.equal(activatedTwo.bridgeActivated, true);
  await request(playerOne, 'puzzle:activate-switch'); // Repeated activation is safe.
  const isolatedBridge = await waitFor(
    thirdClient,
    'room:state',
    (state) => state.roomCode === otherRoom.roomCode,
    'separate room bridge state',
  );
  assert.equal(isolatedBridge.bridgeActivated, false);
  report('switch distance validation, bridge broadcast, repeat activation, and room isolation');

  // Walk across the server-collidable bridge and validate the exit on the server.
  const reachedExit = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode && playerAt(state, 1).z < -8.7,
    'cross the bridge to the exit',
    12000,
  );
  sendInput(playerOne, { forward: true });
  await reachedExit;
  sendInput(playerOne);

  const distantCompletion = await request(playerTwo, 'puzzle:complete-level');
  assert.equal(distantCompletion.code, 'too-far');
  playerOne.emit('player:set-paused', true);
  const pausedCompletion = await request(playerOne, 'puzzle:complete-level');
  assert.equal(pausedCompletion.ok, false);
  assert.equal(pausedCompletion.code, 'paused');
  playerOne.emit('player:set-paused', false);
  const completionForOne = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode && state.levelComplete,
    'completion on Player 1',
  );
  const completionForTwo = waitFor(
    playerTwo,
    'room:state',
    (state) => state.roomCode === created.roomCode && state.levelComplete,
    'completion on Player 2',
  );
  const completion = await request(playerOne, 'puzzle:complete-level');
  assert.equal(completion.ok, true);
  const [completeOne, completeTwo] = await Promise.all([completionForOne, completionForTwo]);
  assert.equal(completeOne.levelComplete, true);
  assert.equal(completeTwo.levelComplete, true);
  const otherRoomState = await waitFor(
    thirdClient,
    'room:state',
    (state) => state.roomCode === otherRoom.roomCode,
    'separate room completion state',
  );
  assert.equal(otherRoomState.levelComplete, false);
  playerOne.emit('player:set-paused', true);
  const pausedAdvance = await request(playerOne, 'puzzle:advance-level');
  assert.equal(pausedAdvance.ok, false);
  assert.equal(pausedAdvance.code, 'paused');
  playerOne.emit('player:set-paused', false);
  report('server validates the exit; both room members complete; other room stays unchanged');

  // Completing Level 1 advances both players together and leaves other rooms untouched.
  const levelTwoForOne = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode && state.activeLevel === 2,
    'Level 2 state for Player 1',
  );
  const levelTwoForTwo = waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode && state.activeLevel === 2,
    'Level 2 state for Player 2',
  );
  const simultaneousAdvances = await Promise.all([
    request(playerOne, 'puzzle:advance-level'),
    request(playerTwo, 'puzzle:advance-level'),
  ]);
  assert.equal(simultaneousAdvances.filter((response) => response.ok).length, 1);
  const advanced = simultaneousAdvances.find((response) => response.ok);
  const rejectedDuplicateAdvance = simultaneousAdvances.find((response) => !response.ok);
  assert.equal(rejectedDuplicateAdvance.code, 'level-not-complete');
  assert.equal(advanced.activeLevel, 2);
  const [nextStateOne, nextStateTwo] = await Promise.all([levelTwoForOne, levelTwoForTwo]);
  assert.deepEqual(nextStateOne.levelTwoSwitches, [false, false]);
  assert.deepEqual(nextStateTwo.levelTwoSwitches, [false, false]);
  const otherRoomLevel = await waitFor(
    thirdClient, 'room:state', (state) => state.roomCode === otherRoom.roomCode,
    'other room level remains unchanged',
  );
  assert.equal(otherRoomLevel.activeLevel, 1);
  report('simultaneous Continue requests advance the room exactly once; other room remains on Level 1');

  const invalidSwitch = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 9 });
  assert.equal(invalidSwitch.code, 'invalid-switch');
  const prematureSecondSwitch = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 1 });
  assert.equal(prematureSecondSwitch.code, 'too-far');
  const prematureLevelTwoExit = await request(playerTwo, 'puzzle:complete-level');
  assert.equal(prematureLevelTwoExit.code, 'too-far');

  // Switch index 1 must be rejected even when the player is standing beside it.
  await moveToZ(playerTwo, created.roomCode, 2, -1.1, 'Player 2 reaches first jump edge');
  await jumpForwardToZ(playerTwo, created.roomCode, 2, -3.5, 'Player 2 lands on stepping stone');
  await moveToZ(playerTwo, created.roomCode, 2, -3.9, 'Player 2 reaches second jump edge');
  await jumpForwardToZ(playerTwo, created.roomCode, 2, -5.7, 'Player 2 reaches violet switch first');
  const wrongSequence = await request(playerTwo, 'puzzle:activate-switch', { switchIndex: 1 });
  assert.equal(wrongSequence.code, 'wrong-sequence');

  // Without a timed bridge, holding forward must cause a fall and a safe respawn.
  const levelTwoRespawn = waitFor(
    playerTwo,
    'room:state',
    (state) => state.roomCode === created.roomCode
      && Math.abs(playerAt(state, 2).z - 0.45) < 0.01
      && Math.abs(playerAt(state, 2).y - 0.6) < 0.02,
    'Level 2 fall recovery without a bridge',
    6000,
  );
  sendInput(playerTwo, { forward: true });
  await levelTwoRespawn;
  sendInput(playerTwo);
  report('violet switch is rejected before cyan; missing bridge cannot be bypassed; fall respawns safely');

  const firstSwitchForOne = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode
      && state.levelTwoSwitches?.[0] === true,
    'first Level 2 switch for Player 1',
  );
  const firstSwitchForTwo = waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode
      && state.levelTwoSwitches?.[0] === true,
    'first Level 2 switch for Player 2',
  );
  const firstSwitch = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 0 });
  assert.equal(firstSwitch.ok, true);
  const [firstPuzzleStateOne, firstPuzzleStateTwo] = await Promise.all([
    firstSwitchForOne, firstSwitchForTwo,
  ]);
  assert.deepEqual(firstPuzzleStateOne.levelTwoSwitches, [true, false]);
  assert.deepEqual(firstPuzzleStateTwo.levelTwoSwitches, [true, false]);
  assert.equal(firstPuzzleStateOne.levelTwoBridgeEndsAt, 0);
  report('Level 2 validates switch order and shares the first switch state across both clients');

  // Cross two short gaps with jumps, then activate the far switch to start the timed bridge.
  await moveToZ(playerOne, created.roomCode, 1, -1.1, 'reach the first jump edge');
  await jumpForwardToZ(playerOne, created.roomCode, 1, -3.5, 'land on the stepping stone');
  await moveToZ(playerOne, created.roomCode, 1, -3.9, 'reach the second jump edge');
  await jumpForwardToZ(playerOne, created.roomCode, 1, -5.7, 'land beside the violet switch');
  const secondSwitchForOne = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode
      && state.levelTwoSwitches?.[1] === true,
    'timed bridge state for Player 1',
  );
  const secondSwitchForTwo = waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode
      && state.levelTwoSwitches?.[1] === true,
    'timed bridge state for Player 2',
  );
  const secondSwitch = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 1 });
  assert.equal(secondSwitch.ok, true);
  assert.ok(secondSwitch.levelTwoBridgeEndsAt > Date.now());
  const [timedStateOne, timedStateTwo] = await Promise.all([
    secondSwitchForOne, secondSwitchForTwo,
  ]);
  assert.equal(timedStateOne.levelTwoBridgeEndsAt, timedStateTwo.levelTwoBridgeEndsAt);
  assert.equal(timedStateTwo.levelTwoSwitches[1], true);
  const activeRepeat = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 1 });
  assert.equal(activeRepeat.ok, true);
  assert.equal(activeRepeat.levelTwoBridgeEndsAt, secondSwitch.levelTwoBridgeEndsAt);
  const isolatedLevelTwo = await waitFor(
    thirdClient, 'room:state', (state) => state.roomCode === otherRoom.roomCode,
    'separate room level 2 puzzle state',
  );
  assert.deepEqual(isolatedLevelTwo.levelTwoSwitches, [false, false]);
  assert.equal(isolatedLevelTwo.levelTwoBridgeEndsAt, 0);
  report('jump route reaches second switch; timed bridge is shared, non-extendable while active, and room-isolated');

  // Let the actual 15-second server deadline expire, prove the bridge cannot be crossed,
  // then reactivate the violet switch to recharge it.
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.max(0, secondSwitch.levelTwoBridgeEndsAt - Date.now() + 150),
  ));
  assert.ok(Date.now() > secondSwitch.levelTwoBridgeEndsAt);
  const expiredBridgeState = await waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode
      && state.levelTwoBridgeEndsAt === secondSwitch.levelTwoBridgeEndsAt,
    'expired Level 2 bridge state',
  );
  assert.equal(expiredBridgeState.levelTwoBridgeEndsAt > Date.now(), false);
  const expiredBridgeRespawn = waitFor(
    playerOne,
    'room:state',
    (state) => state.roomCode === created.roomCode
      && Math.abs(playerAt(state, 1).z - 0.45) < 0.01
      && Math.abs(playerAt(state, 1).y - 0.6) < 0.02,
    'respawn after expired bridge crossing attempt',
    6000,
  );
  sendInput(playerOne, { forward: true });
  await expiredBridgeRespawn;
  sendInput(playerOne);
  await moveToZ(playerOne, created.roomCode, 1, -1.1, 'Player 1 returns to first jump edge');
  await jumpForwardToZ(playerOne, created.roomCode, 1, -3.5, 'Player 1 lands on stepping stone again');
  await moveToZ(playerOne, created.roomCode, 1, -3.9, 'Player 1 returns to second jump edge');
  await jumpForwardToZ(playerOne, created.roomCode, 1, -5.7, 'Player 1 returns to violet switch');
  const recharged = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 1 });
  assert.equal(recharged.ok, true);
  assert.ok(recharged.levelTwoBridgeEndsAt > Date.now());
  assert.ok(recharged.levelTwoBridgeEndsAt > secondSwitch.levelTwoBridgeEndsAt);
  const rechargedOtherRoom = await waitFor(
    thirdClient, 'room:state', (state) => state.roomCode === otherRoom.roomCode,
    'other room remains isolated after bridge recharge',
  );
  assert.equal(rechargedOtherRoom.levelTwoBridgeEndsAt, 0);
  report('15-second deadline expires; crossing fails and recharges only at the violet switch');

  const reachedLevelTwoExit = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode
      && playerAt(state, 1).z < -11,
    'walk across timed bridge to Level 2 exit',
    8000,
  );
  sendInput(playerOne, { forward: true });
  await reachedLevelTwoExit;
  sendInput(playerOne);
  const levelTwoCompletionForOne = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode && state.levelComplete,
    'Level 2 completion for Player 1',
  );
  const levelTwoCompletionForTwo = waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode && state.levelComplete,
    'Level 2 completion for Player 2',
  );
  const completedLevelTwo = await request(playerOne, 'puzzle:complete-level');
  assert.equal(completedLevelTwo.ok, true);
  await Promise.all([levelTwoCompletionForOne, levelTwoCompletionForTwo]);
  report('server validates and synchronizes Level 2 completion for both room members');

  // Level 3 begins as the same room state for both players, while other rooms
  // stay on their own level and puzzle progress.
  const levelThreeForOne = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode && state.activeLevel === 3,
    'Level 3 state for Player 1',
  );
  const levelThreeForTwo = waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode && state.activeLevel === 3,
    'Level 3 state for Player 2',
  );
  playerTwo.emit('player:set-paused', true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const advancedToThree = await request(playerOne, 'puzzle:advance-level');
  assert.equal(advancedToThree.ok, true);
  assert.equal(advancedToThree.activeLevel, 3);
  const [stateThreeOne, stateThreeTwo] = await Promise.all([levelThreeForOne, levelThreeForTwo]);
  assert.equal(stateThreeOne.levelThreeProgress, 0);
  assert.equal(stateThreeTwo.levelThreeBridgeActivated, false);
  assert.equal(otherRoomLevel.activeLevel, 1);
  sendInput(playerTwo, { forward: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const pausedAcrossTransition = await waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode
      && Math.abs(playerAt(state, 2).z - 0.45) < 0.01,
    'paused Player 2 remains paused after the room changes levels',
  );
  assert.equal(pausedAcrossTransition.activeLevel, 3);
  playerTwo.emit('player:set-paused', false);
  sendInput(playerTwo);
  report('Level 2 completion advances both clients once; pause stays local through the transition');

  const prematureLevelThreeExit = await request(playerOne, 'puzzle:complete-level');
  assert.equal(prematureLevelThreeExit.ok, false);
  assert.equal(prematureLevelThreeExit.code, 'too-far');
  const invalidRelay = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 3 });
  assert.equal(invalidRelay.code, 'invalid-switch');
  const distantRelay = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 2 });
  assert.equal(distantRelay.code, 'too-far');

  // Player 2 reaches the violet relay before the sequence and must not unlock it.
  await moveToZ(playerTwo, created.roomCode, 2, -1.1, 'Level 3 Player 2 reaches first jump edge');
  await jumpForwardToZ(playerTwo, created.roomCode, 2, -3.5, 'Level 3 Player 2 lands on first island');
  await moveToZ(playerTwo, created.roomCode, 2, -3.9, 'Level 3 Player 2 reaches second jump edge');
  await jumpForwardToZ(playerTwo, created.roomCode, 2, -5.7, 'Level 3 Player 2 reaches violet relay first');
  const wrongRelay = await request(playerTwo, 'puzzle:activate-switch', { switchIndex: 2 });
  assert.equal(wrongRelay.code, 'sequence-reset');
  assert.equal(wrongRelay.levelThreeProgress, 0);
  const noBridgeRespawn = waitFor(
    playerTwo,
    'room:state',
    (state) => state.roomCode === created.roomCode
      && Math.abs(playerAt(state, 2).z - 0.45) < 0.01
      && Math.abs(playerAt(state, 2).y - 0.6) < 0.02,
    'Level 3 fall recovery without the resonant bridge',
    6000,
  );
  sendInput(playerTwo, { forward: true });
  await noBridgeRespawn;
  sendInput(playerTwo);
  report('Level 3 rejects distant, invalid, premature and out-of-order interactions; locked bridge cannot be bypassed');

  const levelThreeStateOne = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode
      && state.levelThreeProgress === 1,
    'cyan relay state for Player 1',
  );
  const levelThreeStateTwo = waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode
      && state.levelThreeProgress === 1,
    'cyan relay state for Player 2',
  );
  const cyanRelay = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 0 });
  assert.equal(cyanRelay.ok, true);
  const [cyanStateOne, cyanStateTwo] = await Promise.all([levelThreeStateOne, levelThreeStateTwo]);
  assert.equal(cyanStateOne.levelThreeBridgeActivated, false);
  assert.equal(cyanStateTwo.levelThreeProgress, 1);

  await moveToZ(playerOne, created.roomCode, 1, -1.1, 'Level 3 Player 1 reaches first jump edge');
  await jumpForwardToZ(playerOne, created.roomCode, 1, -3.5, 'Level 3 Player 1 reaches amber relay');
  const amberRelay = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 1 });
  assert.equal(amberRelay.ok, true);
  assert.equal(amberRelay.levelThreeProgress, 2);
  await moveToZ(playerOne, created.roomCode, 1, -3.9, 'Level 3 Player 1 reaches second jump edge');
  await jumpForwardToZ(playerOne, created.roomCode, 1, -5.7, 'Level 3 Player 1 reaches violet relay');
  const completedSequenceForOne = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode
      && state.levelThreeProgress === 3 && state.levelThreeBridgeActivated,
    'Level 3 completed relay sequence for Player 1',
  );
  const completedSequenceForTwo = waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode
      && state.levelThreeProgress === 3 && state.levelThreeBridgeActivated,
    'Level 3 completed relay sequence for Player 2',
  );
  const violetRelay = await request(playerOne, 'puzzle:activate-switch', { switchIndex: 2 });
  assert.equal(violetRelay.ok, true);
  assert.equal(violetRelay.levelThreeBridgeActivated, true);
  const [sequenceStateOne, sequenceStateTwo] = await Promise.all([
    completedSequenceForOne, completedSequenceForTwo,
  ]);
  assert.equal(sequenceStateOne.levelThreeProgress, sequenceStateTwo.levelThreeProgress);
  const isolatedLevelThree = await waitFor(
    thirdClient, 'room:state', (state) => state.roomCode === otherRoom.roomCode,
    'separate room stays isolated from Level 3 relays',
  );
  assert.equal(isolatedLevelThree.activeLevel, 1);
  assert.equal(isolatedLevelThree.levelThreeProgress, 0);
  assert.equal(isolatedLevelThree.levelThreeBridgeActivated, false);
  report('cyan → amber → violet relay sequence synchronizes; bridge unlocks only in that room');

  let lastLevelThreeState;
  const captureLevelThreeState = (state) => {
    if (state.roomCode === created.roomCode) lastLevelThreeState = state;
  };
  playerOne.on('room:state', captureLevelThreeState);
  const reachedLevelThreeExit = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode
      && playerAt(state, 1).z < -11,
    'walk across Level 3 bridge to exit',
    8000,
  ).finally(() => playerOne.off('room:state', captureLevelThreeState));
  sendInput(playerOne, { forward: true });
  await reachedLevelThreeExit.catch((error) => {
    const position = lastLevelThreeState && playerAt(lastLevelThreeState, 1);
    throw new Error(`${error.message}; last Level 3 Player 1 position: ${JSON.stringify(position)}`);
  });
  sendInput(playerOne);
  const levelThreeCompletionForOne = waitFor(
    playerOne, 'room:state', (state) => state.roomCode === created.roomCode && state.levelComplete,
    'Level 3 completion for Player 1',
  );
  const levelThreeCompletionForTwo = waitFor(
    playerTwo, 'room:state', (state) => state.roomCode === created.roomCode && state.levelComplete,
    'Level 3 completion for Player 2',
  );
  const completedLevelThree = await request(playerOne, 'puzzle:complete-level');
  assert.equal(completedLevelThree.ok, true);
  await Promise.all([levelThreeCompletionForOne, levelThreeCompletionForTwo]);
  const beyondFinalLevel = await request(playerOne, 'puzzle:advance-level');
  assert.equal(beyondFinalLevel.ok, false);
  assert.equal(beyondFinalLevel.code, 'level-not-complete');
  report('server validates and synchronizes Level 3 exit completion for both room members');
  report('the final level cannot be advanced or skipped');

  // Disconnect updates the remaining client. Rejoin is intentionally manual.
  const onePlayerSummary = waitFor(
    playerOne,
    'room:players',
    (summary) => summary.roomCode === created.roomCode && summary.playerCount === 1,
    'disconnect membership update',
  );
  playerTwo.disconnect();
  await onePlayerSummary;
  playerTwo.connect();
  await waitUntilConnected(playerTwo);
  const rejoined = await request(playerTwo, 'room:join', { roomCode: created.roomCode });
  assert.equal(rejoined.ok, true);
  assert.equal(rejoined.playerCount, 2);
  assert.equal(rejoined.activeLevel, 3);
  assert.equal(rejoined.levelComplete, true);
  assert.deepEqual(rejoined.levelTwoSwitches, [false, false]);
  assert.equal(rejoined.levelThreeProgress, 3);
  assert.equal(rejoined.levelThreeBridgeActivated, true);
  report('disconnect updates room membership; a reconnect can manually rejoin with its room code');

  const onePlayerAfterLeave = waitFor(
    playerOne,
    'room:players',
    (summary) => summary.roomCode === created.roomCode && summary.playerCount === 1,
    'membership after explicit room leave',
  );
  const leftRoom = await request(playerTwo, 'room:leave');
  assert.equal(leftRoom.ok, true);
  assert.equal(leftRoom.playerCount, 1);
  await onePlayerAfterLeave;
  const rejoinedAfterLeave = await request(playerTwo, 'room:join', { roomCode: created.roomCode });
  assert.equal(rejoinedAfterLeave.ok, true);
  assert.equal(rejoinedAfterLeave.activeLevel, 3);
  assert.equal(rejoinedAfterLeave.levelComplete, true);
  assert.equal(rejoinedAfterLeave.levelThreeBridgeActivated, true);
  report('explicit return-to-lobby leave preserves the remaining player and room progress');

  // When the last player leaves, the server deletes the room and rejects its old code.
  const staleRoomOwner = await connectClient('Temporary room owner');
  const temporaryRoom = await request(staleRoomOwner, 'room:create', null);
  staleRoomOwner.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const staleCodeClient = await connectClient('Stale-code client');
  const staleCodeResponse = await request(staleCodeClient, 'room:join', {
    roomCode: temporaryRoom.roomCode,
  });
  assert.equal(staleCodeResponse.code, 'room-not-found');
  report('last-player disconnect deletes its room; the stale code is rejected');
}

try {
  if (!serverUrl) serverUrl = await startTestServers();
  await runTests();
  console.log('\nMultiplayer regression tests passed.');
} catch (error) {
  console.error(`\nMultiplayer regression tests failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const socket of clients) socket.disconnect();
  await stopOwnedProcesses();
}
