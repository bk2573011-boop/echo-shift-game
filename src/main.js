import './style.css';
import { Clock, Vector3 } from 'three';
import { createEchoScene } from './scene.js';
import { setupRoomLobby } from './multiplayer.js';
import { createGameAudio } from './audio.js';

const canvas = document.querySelector('#game-canvas');
const interactionPrompt = document.querySelector('#interaction-prompt');
const completionMessage = document.querySelector('#level-complete');
const completionEyebrow = document.querySelector('#completion-eyebrow');
const completionTitle = document.querySelector('#completion-title');
const continueLevelButton = document.querySelector('#continue-level');
const replayButton = document.querySelector('#replay-game');
const mainMenu = document.querySelector('#main-menu');
const gameRoot = document.querySelector('#game');
const roomPanel = document.querySelector('.room-panel');
const playSoloButton = document.querySelector('#play-solo');
const pauseButton = document.querySelector('#pause-button');
const pauseMenu = document.querySelector('#pause-menu');
const resumeButton = document.querySelector('#resume-game');
const returnToLobbyButton = document.querySelector('#return-to-lobby');
const pauseStatus = document.querySelector('#pause-status');
const objectiveHud = document.querySelector('#objective-hud');
const gameAudio = createGameAudio(document.querySelector('#audio-toggle'));
const {
  renderer,
  scene,
  camera,
  crystal,
  player,
  remotePlayers,
  cameraOffset,
  platformTop,
  platformRadius,
  playerHeight,
  bridgePanels,
  bridgePanelCount,
  bridgeCenterZ,
  bridgeLength,
  switchPosition,
  puzzleSwitch,
  switchButtonMaterial,
  switchButton,
  switchRing,
  stars,
  debris,
  portal,
  portalPosition,
  exitPlatformZ,
  exitPlatformRadius,
  levelTwo,
  levelTwoX,
  levelTwoPlatforms,
  levelTwoSwitches,
  levelTwoBridgePanels,
  levelTwoBridgeCenterZ,
  levelTwoBridgeLength,
  levelTwoPortal,
  levelTwoPortalPosition,
  levelTwoExitZ,
  levelTwoExitRadius,
  levelThree,
  levelThreeX,
  levelThreePlatforms,
  levelThreeRelays,
  levelThreeBridgePanels,
  levelThreeBridgeCenterZ,
  levelThreeBridgeLength,
  levelThreePortal,
  levelThreePortalPosition,
} = createEchoScene(canvas);

const clock = new Clock();
const pressedKeys = new Set();
const movementSpeed = 3.2;
const jumpStrength = 5.2;
const gravity = 14;
const groundCenterY = platformTop + playerHeight / 2;
const cameraTarget = new Vector3();
const desiredCameraPosition = new Vector3();
const authoritativePosition = new Vector3();
const movementKeys = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
]);

let verticalVelocity = 0;
let jumpRequested = false;
let activationRequested = false;
let bridgeActivated = false;
let activeLevel = 1;
let levelTwoSwitchesActivated = [false, false];
let levelTwoBridgeEndsAt = 0;
let levelThreeProgress = 0;
let levelThreeBridgeActivated = false;
let levelThreeBridgeProgress = 0;
let bridgeProgress = 0;
let levelComplete = false;
let completionRequested = false;
let gameStarted = false;
let gamePaused = false;
let pauseStartedAt = 0;
let wasMultiplayerSession = false;
let playerSlot = 1;
let hasAuthoritativePosition = false;
let wasMoving = false;
let lastObjective = '';
let multiplayer;

function getMovementInput() {
  return {
    left: pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft'),
    right: pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight'),
    forward: pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp'),
    backward: pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown'),
    jump: pressedKeys.has('Space'),
  };
}

function sendMovementInput() {
  multiplayer?.sendInput(getMovementInput());
}

function clearMovementInput() {
  pressedKeys.clear();
  jumpRequested = false;
  activationRequested = false;
  sendMovementInput();
}

function startGameplay() {
  // Keep the same lobby element and handlers, but move it out of the menu
  // overlay so it remains available during single-player or multiplayer play.
  gameRoot.append(roomPanel);
  gameStarted = true;
  gamePaused = false;
  pauseStartedAt = 0;
  pauseMenu.hidden = true;
  pauseButton.hidden = false;
  pauseButton.setAttribute('aria-pressed', 'false');
  resumeButton.disabled = false;
  mainMenu.hidden = true;
  canvas.focus({ preventScroll: true });
}

function openMainMenu() {
  clearMovementInput();
  gameStarted = false;
  gamePaused = false;
  levelComplete = false;
  pauseStartedAt = 0;
  completionMessage.hidden = true;
  continueLevelButton.hidden = true;
  replayButton.hidden = true;
  remotePlayers.forEach((avatar) => { avatar.visible = false; });
  wasMultiplayerSession = false;
  // The lobby is part of the title screen while the menu is open.
  mainMenu.append(roomPanel);
  mainMenu.hidden = false;
  pauseMenu.hidden = true;
  pauseButton.hidden = true;
  mainMenu.focus?.({ preventScroll: true });
  playSoloButton.focus({ preventScroll: true });
}

function setGameplayPaused(shouldPause) {
  if (!gameStarted || (shouldPause && levelComplete) || gamePaused === shouldPause) return;

  gamePaused = shouldPause;
  clearMovementInput();
  pauseMenu.hidden = !gamePaused;
  pauseButton.setAttribute('aria-pressed', String(gamePaused));
  if (gamePaused) {
    pauseStartedAt = Date.now();
    pauseStatus.textContent = wasMultiplayerSession
      ? 'Your character is paused. Your partner can keep playing.'
      : 'Your game is paused. Resume when you are ready.';
    multiplayer?.setPaused(true);
    resumeButton.focus({ preventScroll: true });
  } else {
    if (!wasMultiplayerSession && activeLevel === 2 && levelTwoBridgeEndsAt > 0) {
      levelTwoBridgeEndsAt += Date.now() - pauseStartedAt;
    }
    pauseStartedAt = 0;
    multiplayer?.setPaused(false);
    sendMovementInput();
    canvas.focus({ preventScroll: true });
  }
}

function returnToLobby() {
  if (!multiplayer.currentRoomCode) {
    openMainMenu();
    return;
  }

  pauseStatus.textContent = 'Leaving the room…';
  multiplayer.leaveRoom((leftRoom) => {
    if (!leftRoom) {
      pauseStatus.textContent = 'Could not leave yet. Check your connection and try again.';
      return;
    }
    openMainMenu();
  });
}

function showLevelComplete() {
  if (!levelComplete) gameAudio.complete();
  levelComplete = true;
  objectiveHud.textContent = 'OBJECTIVE · Memory restored';
  completionMessage.hidden = false;
  continueLevelButton.hidden = activeLevel >= 3;
  replayButton.hidden = activeLevel < 3;
  completionEyebrow.textContent = activeLevel >= 3 ? 'ALL MEMORIES RESTORED' : 'MEMORY RESTORED';
  completionTitle.textContent = activeLevel >= 3 ? 'GAME COMPLETE' : 'LEVEL COMPLETE';
  if (!continueLevelButton.hidden) continueLevelButton.textContent = `Enter Level ${activeLevel + 1}`;
  replayButton.textContent = multiplayer?.currentRoomCode ? 'Return to Lobby' : 'Play Again';
  interactionPrompt.hidden = true;
}

function setActiveLevel(level, forceReset = false) {
  if (level !== 1 && level !== 2 && level !== 3) return;
  if (!forceReset && activeLevel === level
    && levelTwo.visible === (level === 2)
    && levelThree.visible === (level === 3)) return;

  const changedLevel = activeLevel !== level;
  activeLevel = level;
  lastObjective = '';
  player.scale.set(1, 1, 1);
  player.material.emissiveIntensity = 0.45;
  wasMoving = false;
  levelTwo.visible = level === 2;
  levelThree.visible = level === 3;
  bridgeActivated = false;
  bridgeProgress = 0;
  switchButton.position.y = 0.23;
  switchButtonMaterial.emissiveIntensity = 2.2;
  bridgePanels.forEach((panel) => {
    panel.position.y = -1.8;
    panel.visible = false;
  });
  levelTwoBridgePanels.forEach((panel) => {
    panel.position.y = -1.8;
    panel.visible = false;
  });
  levelTwoSwitchesActivated = [false, false];
  levelTwoBridgeEndsAt = 0;
  applyLevelTwoPuzzle(levelTwoSwitchesActivated, 0);
  levelThreeProgress = 0;
  levelThreeBridgeActivated = false;
  levelThreeBridgeProgress = 0;
  applyLevelThreePuzzle(0, false);
  levelComplete = false;
  completionRequested = false;
  completionMessage.hidden = true;
  interactionPrompt.hidden = true;
  verticalVelocity = 0;
  hasAuthoritativePosition = false;

  if (level === 2) {
    player.position.set(levelTwoX, groundCenterY, 0.45);
    objectiveHud.textContent = 'LEVEL 02 · Activate the cyan switch, then the violet switch';
  } else if (level === 3) {
    player.position.set(levelThreeX, groundCenterY, 0.45);
    objectiveHud.textContent = 'LEVEL 03 · Resonate cyan → amber → violet';
  } else {
    player.position.set(0.95, groundCenterY, 1.05);
    objectiveHud.textContent = 'LEVEL 01 · Find the cyan switch';
  }

  if (changedLevel) {
    objectiveHud.classList.remove('objective-hud--level-transition');
    void objectiveHud.offsetWidth;
    objectiveHud.classList.add('objective-hud--level-transition');
  }
}

function applyLevelTwoPuzzle(switchStates, bridgeEndsAt) {
  const nextStates = Array.isArray(switchStates) && switchStates.length === 2
    ? switchStates.map(Boolean)
    : [false, false];
  nextStates.forEach((isActive, index) => {
    const wasActive = levelTwoSwitchesActivated[index];
    const puzzleSwitch = levelTwoSwitches[index];
    puzzleSwitch.button.position.y = isActive ? 0.16 : 0.23;
    puzzleSwitch.material.emissiveIntensity = isActive ? 3.2 : 2.2;
    if (isActive && !wasActive) gameAudio.switch();
  });
  levelTwoSwitchesActivated = nextStates;

  const nextEndsAt = Number.isFinite(bridgeEndsAt) ? bridgeEndsAt : 0;
  if (nextEndsAt > levelTwoBridgeEndsAt) gameAudio.bridge();
  levelTwoBridgeEndsAt = nextEndsAt;
}

function applyLevelThreePuzzle(progress, bridgeActivated) {
  const safeProgress = Number.isInteger(progress) ? Math.max(0, Math.min(progress, 3)) : 0;
  if (safeProgress > levelThreeProgress) gameAudio.switch();
  if (!levelThreeBridgeActivated && bridgeActivated) gameAudio.bridge();
  levelThreeProgress = safeProgress;
  levelThreeBridgeActivated = bridgeActivated === true;
}

function advanceToLevelTwo() {
  if (!levelComplete || activeLevel >= 3) return;
  if (multiplayer.currentRoomCode) {
    multiplayer.advanceLevel((advanced) => {
      // A second player's simultaneous Continue may be rejected after the
      // server has already advanced this client through the room-state event.
      if (!advanced && levelComplete) {
        completionMessage.hidden = false;
      }
    });
    return;
  }
  setActiveLevel(activeLevel + 1);
}

continueLevelButton.addEventListener('click', advanceToLevelTwo);

function setBridgeActivated(isActivated) {
  if (bridgeActivated === isActivated) return;

  bridgeActivated = isActivated;
  if (bridgeActivated) {
    gameAudio.switch();
    gameAudio.bridge();
    switchButton.position.y = 0.16;
    switchButtonMaterial.emissiveIntensity = 3.2;
  }
  if (!bridgeActivated) {
    bridgeProgress = 0;
    bridgePanels.forEach((panel) => {
      panel.position.y = -1.8;
      panel.visible = false;
    });
  }
}

function applyRoomState(state) {
  if (!state || state.roomCode !== multiplayer.currentRoomCode) return;
  if (state.activeLevel === 1 || state.activeLevel === 2) setActiveLevel(state.activeLevel);
  if (state.activeLevel === 3) setActiveLevel(3);
  if (typeof state.bridgeActivated === 'boolean') {
    setBridgeActivated(state.bridgeActivated);
  }
  applyLevelTwoPuzzle(state.levelTwoSwitches, state.levelTwoBridgeEndsAt);
  applyLevelThreePuzzle(state.levelThreeProgress, state.levelThreeBridgeActivated);
  if (state.levelComplete === true) {
    showLevelComplete();
  }

  const ownPlayer = state.players?.find((roomPlayer) => roomPlayer.slot === playerSlot);
  if (ownPlayer) {
    authoritativePosition.set(ownPlayer.x, ownPlayer.y, ownPlayer.z);
    hasAuthoritativePosition = true;
  }

  const remoteBySlot = new Map(remotePlayers.map((avatar, index) => [index + 1, avatar]));
  remotePlayers.forEach((avatar) => { avatar.visible = false; });
  for (const roomPlayer of state.players ?? []) {
    if (roomPlayer.slot === playerSlot) continue;
    const avatar = remoteBySlot.get(roomPlayer.slot);
    if (!avatar) continue;
    avatar.userData.targetPosition ??= new Vector3();
    avatar.userData.targetPosition.set(roomPlayer.x, roomPlayer.y, roomPlayer.z);
    avatar.userData.targetRotation = roomPlayer.rotationY;
    avatar.visible = true;
  }
}

multiplayer = setupRoomLobby({
  onRoomJoined(roomState) {
    wasMultiplayerSession = true;
    playerSlot = roomState.playerSlot;
    levelComplete = false;
    completionRequested = false;
    completionMessage.hidden = true;
    startGameplay();
    setActiveLevel(roomState.activeLevel ?? 1);
    verticalVelocity = 0;
    hasAuthoritativePosition = false;
    applyRoomState(roomState);
    sendMovementInput();
  },
});
multiplayer.socket.on('room:state', applyRoomState);
multiplayer.socket.on('disconnect', () => {
  hasAuthoritativePosition = false;
  remotePlayers.forEach((avatar) => { avatar.visible = false; });
  if (wasMultiplayerSession && gameStarted) {
    gamePaused = true;
    clearMovementInput();
    pauseMenu.hidden = false;
    pauseButton.setAttribute('aria-pressed', 'true');
    pauseStatus.textContent = 'Connection lost. Return to the lobby, then rejoin with your room code.';
    resumeButton.disabled = true;
    returnToLobbyButton.focus({ preventScroll: true });
  }
});

playSoloButton.addEventListener('click', () => {
  if (multiplayer.currentRoomCode) return;
  wasMultiplayerSession = false;
  remotePlayers.forEach((avatar) => { avatar.visible = false; });
  remotePlayers.forEach((avatar) => { avatar.visible = false; });
  setActiveLevel(1, true);
  startGameplay();
});

pauseButton.addEventListener('click', () => setGameplayPaused(true));
resumeButton.addEventListener('click', () => setGameplayPaused(false));
returnToLobbyButton.addEventListener('click', returnToLobby);

replayButton.addEventListener('click', () => {
  if (multiplayer.currentRoomCode) {
    returnToLobby();
    return;
  }
  wasMultiplayerSession = false;
  setActiveLevel(1, true);
  startGameplay();
});

window.addEventListener('keydown', (event) => {
  if (gamePaused && event.code === 'Tab') {
    const focusables = [resumeButton, returnToLobbyButton].filter((button) => !button.disabled);
    const currentIndex = focusables.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex === focusables.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusables[nextIndex]?.focus({ preventScroll: true });
    return;
  }
  if (event.code === 'Escape') {
    if (gameStarted && !levelComplete && !resumeButton.disabled) {
      event.preventDefault();
      setGameplayPaused(!gamePaused);
    }
    return;
  }
  if (event.target instanceof Element && event.target.closest('button, input, summary')) {
    pressedKeys.clear();
    jumpRequested = false;
    sendMovementInput();
    return;
  }
  if (!gameStarted || gamePaused || levelComplete) return;
  if (event.target instanceof Element && event.target.closest('.room-panel')) {
    pressedKeys.clear();
    jumpRequested = false;
    sendMovementInput();
    return;
  }
  if (movementKeys.has(event.code) || event.code === 'Space' || event.code === 'KeyE') {
    event.preventDefault();
  }
  if (event.code === 'Space' && !pressedKeys.has('Space')) {
    jumpRequested = true;
  }
  if (event.code === 'KeyE' && !pressedKeys.has('KeyE')) {
    activationRequested = true;
  }
  pressedKeys.add(event.code);
  sendMovementInput();
});

window.addEventListener('keyup', (event) => {
  pressedKeys.delete(event.code);
  sendMovementInput();
});
window.addEventListener('blur', () => {
  pressedKeys.clear();
  jumpRequested = false;
  sendMovementInput();
});

// The player can stand on either island, or on the bridge after the switch is used.
function isOnWalkableSurface(x, z) {
  if (activeLevel === 2) {
    const onIsland = levelTwoPlatforms.some((platform) =>
      Math.hypot(x - platform.x, z - platform.z) <= platform.radius);
    const onTimedBridge = levelTwoBridgeEndsAt > Date.now()
      && Math.abs(x - levelTwoX) <= 1.0
      && z >= levelTwoBridgeCenterZ - levelTwoBridgeLength / 2
      && z <= levelTwoBridgeCenterZ + levelTwoBridgeLength / 2;
    return onIsland || onTimedBridge;
  }

  if (activeLevel === 3) {
    const onIsland = levelThreePlatforms.some((platform) =>
      Math.hypot(x - platform.x, z - platform.z) <= platform.radius);
    const onUnlockedBridge = levelThreeBridgeActivated
      && Math.abs(x - levelThreeX) <= 1.0
      && z >= levelThreeBridgeCenterZ - levelThreeBridgeLength / 2
      && z <= levelThreeBridgeCenterZ + levelThreeBridgeLength / 2;
    return onIsland || onUnlockedBridge;
  }

  const onStartingPlatform = Math.hypot(x, z) <= platformRadius;
  const onExitPlatform = Math.hypot(x, z - exitPlatformZ) <= exitPlatformRadius;
  const onBridge = bridgeActivated
    && Math.abs(x) <= 1.02
    && z >= bridgeCenterZ - bridgeLength / 2
    && z <= bridgeCenterZ + bridgeLength / 2;

  return onStartingPlatform || onExitPlatform || onBridge;
}

function animateBridge(delta) {
  if (activeLevel !== 1 || !bridgeActivated) return;

  bridgeProgress = Math.min(bridgeProgress + delta / 1.8, 1);
  const panelSpacing = bridgeLength / bridgePanelCount;
  const panelTargetY = platformTop - 0.11;

  bridgePanels.forEach((panel, index) => {
    // Each panel rises after the one before it, like a short wave crossing the gap.
    const panelProgress = Math.max(0, Math.min(bridgeProgress * bridgePanelCount - index, 1));
    const easedProgress = panelProgress * panelProgress * (3 - 2 * panelProgress);
    panel.position.y = -1.8 + (panelTargetY + 1.8) * easedProgress;
    panel.visible = panelProgress > 0;
    panel.position.z = bridgeCenterZ + bridgeLength / 2 - (index + 0.5) * panelSpacing;
  });
}

function animateLevelTwoBridge(elapsed) {
  const remaining = Math.max(0, levelTwoBridgeEndsAt - Date.now());
  const raiseProgress = Math.min(1, remaining > 0 ? (15_000 - remaining) / 700 : 0);
  const progress = raiseProgress > 0 ? raiseProgress : 0;
  levelTwoBridgePanels.forEach((panel, index) => {
    const panelProgress = Math.max(0, Math.min(progress * levelTwoBridgePanels.length - index, 1));
    const eased = panelProgress * panelProgress * (3 - 2 * panelProgress);
    panel.position.y = -1.8 + (platformTop - 0.11 + 1.8) * eased;
    panel.visible = panelProgress > 0;
    panel.material.emissiveIntensity = 0.8 + Math.sin(elapsed * 5 + index) * 0.12;
  });
  levelTwoPortal.rotation.z = Math.sin(elapsed * 0.7) * 0.035;
  levelTwoPortal.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.025);
}

function animateLevelThreeBridge(delta, elapsed) {
  if (activeLevel === 3 && levelThreeBridgeActivated) {
    levelThreeBridgeProgress = Math.min(levelThreeBridgeProgress + delta / 1.25, 1);
  }
  levelThreeBridgePanels.forEach((panel, index) => {
    const panelProgress = Math.max(0, Math.min(
      levelThreeBridgeProgress * levelThreeBridgePanels.length - index, 1,
    ));
    const eased = panelProgress * panelProgress * (3 - 2 * panelProgress);
    panel.position.y = -1.8 + (platformTop - 0.11 + 1.8) * eased;
    panel.visible = panelProgress > 0;
    panel.material.emissiveIntensity = 0.9 + Math.sin(elapsed * 3.4 + index) * 0.12;
  });
  levelThreeRelays.forEach((relay, index) => {
    relay.shard.rotation.y += delta * (0.45 + index * 0.08);
    relay.shard.position.y = 0.48 + Math.sin(elapsed * 1.8 + index) * 0.08;
    relay.material.emissiveIntensity = index < levelThreeProgress
      ? 3
      : index === levelThreeProgress ? 1.7 + Math.sin(elapsed * 4) * 0.65 : 0.7;
  });
  levelThreePortal.rotation.z = Math.sin(elapsed * 0.7) * 0.035;
  levelThreePortal.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.025);
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  let moveX = 0;
  let moveZ = 0;
  if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) moveX -= 1;
  if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) moveX += 1;
  if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) moveZ -= 1;
  if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) moveZ += 1;

  const sessionCanAdvance = !wasMultiplayerSession || Boolean(multiplayer.currentRoomCode);
  if (gameStarted && !gamePaused && !levelComplete && sessionCanAdvance) {
    const wasGrounded = player.position.y <= groundCenterY + 0.001
      && isOnWalkableSurface(player.position.x, player.position.z);
    const moveLength = Math.hypot(moveX, moveZ);
    if (moveLength > 0) {
      moveX /= moveLength;
      moveZ /= moveLength;
      player.position.x += moveX * movementSpeed * delta;
      player.position.z += moveZ * movementSpeed * delta;
      player.rotation.y = Math.atan2(moveX, moveZ);
    }

    if (jumpRequested && wasGrounded) {
      verticalVelocity = jumpStrength;
      gameAudio.jump();
    }
    jumpRequested = false;

    const previousY = player.position.y;
    verticalVelocity -= gravity * delta;
    player.position.y += verticalVelocity * delta;

    // Snap the capsule to the platform top when it lands while moving downward.
    if (
      verticalVelocity <= 0
      && previousY >= groundCenterY
      && player.position.y <= groundCenterY
      && isOnWalkableSurface(player.position.x, player.position.z)
    ) {
      const landed = verticalVelocity < -1;
      player.position.y = groundCenterY;
      verticalVelocity = 0;
      if (landed) {
        gameAudio.land();
        player.scale.set(1.12, 0.88, 1.12);
      }
    }

    // The landing squash and recovery are local visual feedback; position remains server-authoritative.
    const squash = 1 - Math.exp(-12 * delta);
    player.scale.x += (1 - player.scale.x) * squash;
    player.scale.y += (1 - player.scale.y) * squash;
    player.scale.z += (1 - player.scale.z) * squash;

    const moving = moveX !== 0 || moveZ !== 0;
    if (moving && !wasMoving && Math.abs(verticalVelocity) < 0.1) {
      player.material.emissiveIntensity = 0.72;
    } else if (!moving && wasMoving) {
      player.material.emissiveIntensity = 0.45;
    }
    wasMoving = moving;

    const standing = Math.abs(player.position.y - groundCenterY) < 0.2;
    let nearbySwitchIndex = -1;
    let objective;
    if (activeLevel === 2) {
      nearbySwitchIndex = levelTwoSwitches.findIndex((puzzleSwitch, index) =>
        (index === 0 ? !levelTwoSwitchesActivated[index]
          : levelTwoSwitchesActivated[0]
            && (!levelTwoSwitchesActivated[index] || levelTwoBridgeEndsAt <= Date.now()))
        && Math.hypot(player.position.x - puzzleSwitch.position.x,
          player.position.z - puzzleSwitch.position.z) <= 1.15);
      const bridgeIsActive = levelTwoBridgeEndsAt > Date.now();
      const bridgeSeconds = Math.ceil(Math.max(0, levelTwoBridgeEndsAt - Date.now()) / 1000);
      objective = !levelTwoSwitchesActivated[0]
        ? 'Switches 0/2 · activate cyan, then jump to violet'
        : !levelTwoSwitchesActivated[1]
          ? 'Switches 1/2 · jump across and activate violet'
          : bridgeIsActive
            ? `Switches 2/2 · bridge fades in ${bridgeSeconds}s; reach the portal`
            : 'Switches 2/2 · bridge faded; return to violet to recharge';
      interactionPrompt.textContent = nearbySwitchIndex === 0
        ? 'Press E to activate cyan switch'
        : nearbySwitchIndex === 1
          ? 'Press E to activate violet switch'
          : 'Press E to activate';
      interactionPrompt.hidden = nearbySwitchIndex < 0 || !standing;
    } else if (activeLevel === 1) {
      const switchDistance = Math.hypot(
        player.position.x - switchPosition.x,
        player.position.z - switchPosition.z,
      );
      const standingNearSwitch = switchDistance <= 1.15 && standing;
      nearbySwitchIndex = standingNearSwitch && !bridgeActivated ? 0 : -1;
      interactionPrompt.textContent = 'Press E to activate';
      interactionPrompt.hidden = bridgeActivated || !standingNearSwitch;
      objective = bridgeActivated ? 'Cross the bridge and reach the portal'
        : standingNearSwitch ? 'Activate the switch with E'
          : 'Find the glowing cyan switch';
    } else {
      const relayNames = ['cyan', 'amber', 'violet'];
      nearbySwitchIndex = levelThreeRelays.findIndex((relay) =>
        Math.hypot(player.position.x - relay.position.x,
          player.position.z - relay.position.z) <= 1.15);
      objective = levelThreeBridgeActivated
        ? 'Echo sequence locked · cross the bridge to the portal'
        : `Echo sequence · cyan → amber → violet (${levelThreeProgress}/3)`;
      interactionPrompt.textContent = nearbySwitchIndex >= 0
        ? `Press E to resonate ${relayNames[nearbySwitchIndex]} relay`
        : 'Press E to resonate';
      interactionPrompt.hidden = nearbySwitchIndex < 0 || !standing || levelThreeBridgeActivated;
    }
    if (objective !== lastObjective) {
      objectiveHud.textContent = activeLevel === 3
        ? `LEVEL 03 · ${objective}`
        : `OBJECTIVE · ${objective}`;
      lastObjective = objective;
    }

    if (activationRequested && nearbySwitchIndex >= 0 && standing) {
      if (multiplayer.currentRoomCode) {
        if (activeLevel === 3 && nearbySwitchIndex !== levelThreeProgress) gameAudio.error();
        multiplayer.activateSwitch(activeLevel === 2 || activeLevel === 3
          ? nearbySwitchIndex
          : null);
      } else if (activeLevel === 1) {
        setBridgeActivated(true);
      } else if (activeLevel === 2 && nearbySwitchIndex === 0) {
        levelTwoSwitchesActivated[0] = true;
        applyLevelTwoPuzzle(levelTwoSwitchesActivated, 0);
      } else if (activeLevel === 2 && levelTwoSwitchesActivated[0]) {
        levelTwoSwitchesActivated[1] = true;
        applyLevelTwoPuzzle(levelTwoSwitchesActivated, Date.now() + 15_000);
      } else if (activeLevel === 3 && !levelThreeBridgeActivated) {
        if (nearbySwitchIndex === levelThreeProgress) {
          const nextProgress = levelThreeProgress + 1;
          applyLevelThreePuzzle(nextProgress, nextProgress === 3);
        } else {
          gameAudio.error();
          applyLevelThreePuzzle(0, false);
        }
      }
    }
    activationRequested = false;

    animateBridge(delta);
    animateLevelTwoBridge(elapsed);
    animateLevelThreeBridge(delta, elapsed);

    const targetPortal = activeLevel === 3 ? levelThreePortalPosition
      : activeLevel === 2 ? levelTwoPortalPosition : portalPosition;
    const portalDistance = Math.hypot(
      player.position.x - targetPortal.x,
      player.position.z - targetPortal.z,
    );
    const puzzleReady = activeLevel === 3
      ? levelThreeProgress === 3 && levelThreeBridgeActivated
      : activeLevel === 2
        ? levelTwoSwitchesActivated.every(Boolean) && levelTwoBridgeEndsAt > Date.now()
        : bridgeActivated;
    if (puzzleReady && portalDistance <= 0.9
      && isOnWalkableSurface(player.position.x, player.position.z)) {
      if (multiplayer.currentRoomCode) {
        if (!completionRequested) {
          completionRequested = true;
          multiplayer.completeLevel((completed) => {
            if (!completed) completionRequested = false;
          });
        }
      } else {
        showLevelComplete();
      }
    }

    // Falling off the islands returns the player to the start so the puzzle is retryable.
    if (player.position.y < -8) {
      player.position.set(
        activeLevel === 3 ? levelThreeX : activeLevel === 2 ? levelTwoX : 0.95,
        groundCenterY,
        activeLevel === 2 || activeLevel === 3 ? 0.45 : 1.05,
      );
      verticalVelocity = 0;
    }
  } else {
    activationRequested = false;
  }

  crystal.position.y = 1.25 + Math.sin(elapsed * 1.4) * 0.12;
  crystal.rotation.y = elapsed * 0.45;
  switchButtonMaterial.emissiveIntensity = 1.8 + Math.sin(elapsed * 3) * 0.5;
  const ringPulse = 1 + Math.sin(elapsed * 2.4) * 0.08;
  switchRing.scale.setScalar(ringPulse);
  portal.rotation.z = Math.sin(elapsed * 0.7) * 0.035;
  portal.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.025);
  stars.rotation.y = elapsed * 0.002;
  debris.children.forEach((shard, index) => {
    shard.rotation.y += delta * (0.08 + index % 4 * 0.015);
    shard.position.y = shard.userData.baseY + Math.sin(elapsed * 0.55 + index) * 0.1;
  });

  if (hasAuthoritativePosition && multiplayer.currentRoomCode) {
    player.position.lerp(authoritativePosition, 1 - Math.exp(-14 * delta));
  }
  remotePlayers.forEach((avatar) => {
    if (!avatar.visible || !avatar.userData.targetPosition) return;
    avatar.position.lerp(avatar.userData.targetPosition, 1 - Math.exp(-12 * delta));
    const rotationDifference = Math.atan2(
      Math.sin(avatar.userData.targetRotation - avatar.rotation.y),
      Math.cos(avatar.userData.targetRotation - avatar.rotation.y),
    );
    avatar.rotation.y += rotationDifference * (1 - Math.exp(-12 * delta));
  });

  // Keep the camera's original angle and distance, but move it smoothly with the player.
  const followSmoothing = 1 - Math.exp(-4 * delta);
  desiredCameraPosition.copy(player.position).add(cameraOffset);
  camera.position.lerp(desiredCameraPosition, followSmoothing);
  cameraTarget.set(player.position.x, player.position.y + 0.25, player.position.z);
  camera.lookAt(cameraTarget);

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});
