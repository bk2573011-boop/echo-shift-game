import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllowedSocketOrigins, isAllowedSocketRequest } from '../server/socket-origin.js';
import { getSocketUrl } from '../src/socket-config.js';


test('production allows configured origins and same-origin requests without Origin only for an allowed host', () => {
  const allowedOrigins = getAllowedSocketOrigins({
    isProduction: true,
    renderExternalUrl: 'https://echo-shift.onrender.com/',
    socketAllowedOrigins: ' https://game.example.com,invalid-origin,ftp://bad.example.com ',
  });

  assert.deepEqual([...allowedOrigins], [
    'https://game.example.com',
    'https://echo-shift.onrender.com',
  ]);
  assert.equal(isAllowedSocketRequest({
    origin: 'https://game.example.com',
    host: 'echo-shift.onrender.com',
    port: 3000,
    allowedOrigins,
  }), true);
  assert.equal(isAllowedSocketRequest({
    origin: 'https://other.example.com',
    host: 'echo-shift.onrender.com',
    port: 3000,
    allowedOrigins,
  }), false);
  assert.equal(isAllowedSocketRequest({
    origin: undefined,
    host: 'echo-shift.onrender.com',
    port: 3000,
    allowedOrigins,
    secFetchSite: 'same-origin',
  }), true);
  assert.equal(isAllowedSocketRequest({
    origin: undefined,
    host: 'untrusted.example.com',
    port: 3000,
    allowedOrigins,
    secFetchSite: 'same-origin',
  }), false);
  assert.equal(isAllowedSocketRequest({
    origin: undefined,
    host: 'echo-shift.onrender.com',
    port: 3000,
    allowedOrigins,
    secFetchSite: 'cross-site',
  }), false);
  assert.equal(isAllowedSocketRequest({
    origin: undefined,
    host: 'echo-shift.onrender.com',
    port: 3000,
    allowedOrigins,
  }), false);
});


test('development allows Vite localhost origins and its no-Origin proxy path', () => {
  const allowedOrigins = getAllowedSocketOrigins({ isProduction: false, vitePort: 5173 });
  assert.equal(allowedOrigins.has('http://localhost:5173'), true);
  assert.equal(allowedOrigins.has('http://127.0.0.1:5173'), true);
  assert.equal(isAllowedSocketRequest({
    origin: undefined,
    host: '127.0.0.1:3001',
    port: 3001,
    allowedOrigins,
  }), true);
  assert.equal(isAllowedSocketRequest({
    origin: undefined,
    host: 'untrusted.example.com',
    port: 3001,
    allowedOrigins,
  }), false);
});


test('client uses the deployed page origin in production and Vite proxy in development', () => {
  assert.equal(getSocketUrl({
    isProduction: true,
    pageOrigin: 'https://game.example.com',
  }), 'https://game.example.com');
  assert.equal(getSocketUrl({
    isProduction: false,
    pageOrigin: 'http://localhost:5173',
  }), undefined);
});
