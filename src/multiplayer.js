import { io } from 'socket.io-client';
import { getSocketUrl } from './socket-config.js';

const roomCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCodePattern = new RegExp(`^[${roomCodeAlphabet}]{6}$`);

export function setupRoomLobby({ onRoomJoined = () => {} } = {}) {
  const createButton = document.querySelector('#create-room');
  const joinForm = document.querySelector('#join-room-form');
  const roomCodeInput = document.querySelector('#room-code-input');
  const statusMessage = document.querySelector('#room-status');
  const roomDetails = document.querySelector('#room-details');
  const roomCodeLabel = document.querySelector('#room-code-label');
  const roomPlayerCount = document.querySelector('#room-player-count');
  const copyRoomCodeButton = document.querySelector('#copy-room-code');

  const socketUrl = getSocketUrl({
    isProduction: import.meta.env.PROD,
    pageOrigin: window.location.origin,
  });
  const socket = io(socketUrl, { timeout: 5000 });
  let currentRoomCode = null;
  let lastRoomCode = null;

  function showStatus(message, kind = 'info') {
    statusMessage.textContent = message;
    statusMessage.dataset.kind = kind;
  }

  function updateButtons() {
    const canChooseRoom = socket.connected && currentRoomCode === null;
    createButton.disabled = !canChooseRoom;
    joinForm.querySelector('button').disabled = !canChooseRoom;
    roomCodeInput.disabled = !canChooseRoom;
    copyRoomCodeButton.disabled = !lastRoomCode;
  }

  function showRoom(response, action) {
    currentRoomCode = response.roomCode;
    lastRoomCode = response.roomCode;
    roomCodeLabel.textContent = response.roomCode;
    roomPlayerCount.textContent = `${response.playerCount}/${response.maxPlayers ?? 8} players`;
    roomDetails.hidden = false;
    updateButtons();

    if (action === 'create') {
      showStatus(
        'Room created. Share the code with up to seven players. Movement, puzzles, and level completion are shared.',
        'success',
      );
    } else {
      showStatus(
        `Joined as player ${response.playerSlot}. Movement, puzzles, and level completion are shared.`,
        'success',
      );
    }
  }

  function showServerError(code, attemptedCode = '') {
    const messages = {
      'invalid-code': 'Enter a valid 6-character room code.',
      'room-not-found': `No open room matches ${attemptedCode}. Check the code and try again.`,
      'room-full': 'Room full. Each room can hold up to 8 players.',
      'already-in-room': 'This browser is already in a room. Refresh to leave it.',
      'rate-limited': 'Too many room requests. Wait a moment and try again.',
    };

    if (code === 'room-not-found' && attemptedCode === lastRoomCode) {
      lastRoomCode = null;
      roomDetails.hidden = true;
      roomCodeInput.value = '';
      updateButtons();
    }
    showStatus(messages[code] ?? 'The room request failed. Please try again.', 'error');
  }

  function requestRoom(eventName, payload, action) {
    socket.timeout(5000).emit(eventName, payload, (timeoutError, response) => {
      if (timeoutError) {
        showStatus('The server did not respond. Check that the game server is running.', 'error');
        return;
      }
      if (!response?.ok) {
        showServerError(response?.code, payload?.roomCode ?? '');
        return;
      }

      showRoom(response, action);
      onRoomJoined(response);
    });
  }

  createButton.addEventListener('click', () => {
    if (!socket.connected) {
      showStatus('Cannot connect. Start the Socket.IO server and try again.', 'error');
      return;
    }
    requestRoom('room:create', null, 'create');
  });

  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const roomCode = roomCodeInput.value.trim().toUpperCase();

    if (!roomCodePattern.test(roomCode)) {
      showServerError('invalid-code');
      roomCodeInput.focus();
      return;
    }
    if (!socket.connected) {
      showStatus('Cannot connect. Start the Socket.IO server and try again.', 'error');
      return;
    }

    requestRoom('room:join', { roomCode }, 'join');
  });

  copyRoomCodeButton.addEventListener('click', async () => {
    if (!lastRoomCode) return;

    try {
      await navigator.clipboard.writeText(lastRoomCode);
      showStatus(`Room code ${lastRoomCode} copied. Share it with up to seven players.`, 'success');
    } catch {
      showStatus('Could not access the clipboard. Select the room code and copy it manually.', 'error');
    }
  });

  socket.on('connect', () => {
    // A reconnect creates a new socket; show the saved code for a manual rejoin.
    currentRoomCode = null;
    roomDetails.hidden = !lastRoomCode;
    updateButtons();
    if (lastRoomCode) {
      roomCodeLabel.textContent = lastRoomCode;
      roomPlayerCount.textContent = 'Rejoin required';
      roomCodeInput.value = lastRoomCode;
      showStatus(`Connection restored. Join again with room code ${lastRoomCode}.`, 'info');
    } else {
      showStatus('Connected. Create a room or join with a code.', 'info');
    }
  });

  socket.on('connect_error', (error) => {
    updateButtons();
    const httpStatus = error?.context?.status;
    const detail = httpStatus ? ` (HTTP ${httpStatus})` : error?.message ? ` (${error.message})` : '';
    showStatus(
      `Connection failed${detail}. Check the server URL and allowed browser origin; the client will keep retrying${lastRoomCode ? `; rejoin ${lastRoomCode} after reconnecting` : ''}.`,
      'error',
    );
  });

  socket.on('disconnect', (reason) => {
    if (currentRoomCode) lastRoomCode = currentRoomCode;
    currentRoomCode = null;
    roomDetails.hidden = !lastRoomCode;
    if (lastRoomCode) {
      roomCodeLabel.textContent = lastRoomCode;
      roomPlayerCount.textContent = 'Connection lost';
    }
    updateButtons();
    showStatus(
      `Disconnected${reason ? ` (${reason})` : ''}. Reconnecting…${lastRoomCode ? ` Keep code ${lastRoomCode} to rejoin.` : ''}`,
      'error',
    );
  });

  socket.on('room:players', (summary) => {
    if (!summary || summary.roomCode !== currentRoomCode) return;

    roomPlayerCount.textContent = `${summary.playerCount}/${summary.maxPlayers} players`;
    if (summary.playerCount === summary.maxPlayers) {
      showStatus('Room full. All 8 players are connected.', 'success');
    } else {
      showStatus(`${summary.playerCount}/${summary.maxPlayers} players connected. Share the room code to invite more.`, 'info');
    }
  });

  updateButtons();
  return {
    socket,
    get currentRoomCode() {
      return currentRoomCode;
    },
    sendInput(input) {
      if (socket.connected && currentRoomCode) {
        socket.emit('player:input', input);
      }
    },
    setPaused(isPaused) {
      if (socket.connected && currentRoomCode) {
        socket.emit('player:set-paused', isPaused === true);
      }
    },
    leaveRoom(onResult = () => {}) {
      if (!currentRoomCode) {
        onResult(true);
        return;
      }
      if (!socket.connected) {
        showStatus('Connection lost. The server will remove this player; rejoin manually if needed.', 'info');
        onResult(true);
        return;
      }

      socket.timeout(5000).emit('room:leave', (timeoutError, response) => {
        if (timeoutError || (!response?.ok && response?.code !== 'not-in-room')) {
          showStatus('Could not leave the room yet. Check the connection and try again.', 'error');
          onResult(false);
          return;
        }

        currentRoomCode = null;
        lastRoomCode = null;
        roomDetails.hidden = true;
        roomCodeInput.value = '';
        updateButtons();
        showStatus('You left the room. Create a room or join another one when ready.', 'info');
        onResult(true);
      });
    },
    activateSwitch(switchIndex = null) {
      if (!socket.connected || !currentRoomCode) return;

      const acknowledge = (timeoutError, response) => {
        if (timeoutError) {
          showStatus('The server did not respond to the switch. Try again.', 'error');
        } else if (!response?.ok) {
          const errorMessages = {
      'wrong-sequence': 'Activate the cyan switch before the violet switch.',
            'sequence-reset': 'Wrong relay. The echo sequence reset to cyan.',
            'too-far': 'Stand beside the switch before activating it.',
            'invalid-switch': 'That switch request was invalid.',
            paused: 'Resume your game before interacting.',
          };
          showStatus(errorMessages[response?.code] ?? 'The switch could not be activated.', 'error');
        } else {
          showStatus('Switch activated. Puzzle state is shared with this room.', 'success');
        }
      };
      const timedSocket = socket.timeout(5000);
      if (switchIndex === null) timedSocket.emit('puzzle:activate-switch', acknowledge);
      else timedSocket.emit('puzzle:activate-switch', { switchIndex }, acknowledge);
    },
    completeLevel(onResult = () => {}) {
      if (!socket.connected || !currentRoomCode) {
        onResult(false);
        return;
      }

      socket.timeout(5000).emit('puzzle:complete-level', (timeoutError, response) => {
        const completed = !timeoutError && response?.ok === true;
        if (timeoutError) {
          showStatus('The server did not respond at the exit. Try again.', 'error');
        } else if (!completed) {
          showStatus('Reach the exit portal while standing on the platform.', 'error');
        } else {
          showStatus('Level complete. Both players have finished this room.', 'success');
        }
        onResult(completed);
      });
    },
    advanceLevel(onResult = () => {}) {
      if (!socket.connected || !currentRoomCode) {
        onResult(false);
        return;
      }
      socket.timeout(5000).emit('puzzle:advance-level', (timeoutError, response) => {
        const advanced = !timeoutError && response?.ok === true
          && (response.activeLevel === 2 || response.activeLevel === 3);
        if (timeoutError) {
          showStatus('The server did not respond. Try entering the next level again.', 'error');
        } else if (!advanced) {
          showStatus('Complete the current level before entering the next one.', 'error');
        } else {
          showStatus(`Level ${response.activeLevel} entered. Puzzle state is shared with this room.`, 'success');
        }
        onResult(advanced);
      });
    },
  };
}
