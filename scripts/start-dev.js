import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

// `npm run dev:all -- --port 5174` gives these arguments to this launcher,
// not to Vite. Translate them into the environment variables used by Vite,
// the game server, and the Vite proxy.
const options = parsePortOptions(process.argv.slice(2));
const configuredVitePort = options.vitePort ?? process.env.VITE_PORT;
const configuredSocketPort = options.socketPort ?? process.env.PORT;
const vitePort = await availablePort(configuredVitePort ?? 5173, configuredVitePort === undefined);
const socketPort = await availablePort(configuredSocketPort ?? 3001, configuredSocketPort === undefined);
const childEnv = {
  ...process.env,
  PORT: String(socketPort),
  VITE_PORT: String(vitePort),
};

console.log(`Starting ECHO SHIFT: Vite http://localhost:${vitePort}/, Socket.IO http://localhost:${socketPort}/`);

// Starting both processes from one command avoids forgetting the Socket.IO server.
const services = [
  { name: 'Socket.IO server', script: 'server/index.js' },
  { name: 'Vite development server', script: 'node_modules/vite/bin/vite.js' },
];

let isStopping = false;
const children = services.map(({ name, script }) => {
  const child = spawn(process.execPath, [script], {
    cwd: projectRoot,
    env: childEnv,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`${name} could not start: ${error.message}`);
    stop(1);
  });

  child.on('exit', (code) => {
    if (isStopping) return;
    console.error(`${name} stopped unexpectedly with exit code ${code ?? 'unknown'}.`);
    stop(code === 0 ? 1 : code ?? 1);
  });

  return child;
});

function stop(exitCode = 0) {
  if (isStopping) return;
  isStopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exitCode = exitCode;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function parsePortOptions(args) {
  let vitePort;
  let socketPort;

  for (let i = 0; i < args.length; i += 1) {
    const option = args[i];
    if (option === '--port' || option === '--vite-port') vitePort = readPort(args[++i], option);
    else if (option === '--server-port' || option === '--socket-port') socketPort = readPort(args[++i], option);
    else throw new Error(`Unknown dev:all option: ${option}`);
  }

  return { vitePort, socketPort };
}

function readPort(value, option) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${option} requires a port number from 1 to 65535.`);
  }
  return port;
}

// Prefer the requested/default port. If the default is already occupied,
// select an OS-assigned free port so an unrelated listener is left untouched.
async function availablePort(preferredPort, allowFallback) {
  const isAvailable = (port) => new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    probe.listen(port, () => {
      probe.close((error) => error ? reject(error) : resolve(true));
    });
  });

  if (await isAvailable(preferredPort)) return preferredPort;
  if (!allowFallback) throw new Error(`Port ${preferredPort} is already in use. Choose another port with --port or --server-port.`);

  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
