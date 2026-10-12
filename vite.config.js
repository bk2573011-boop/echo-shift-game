import { defineConfig } from 'vite';

const socketPort = Number(process.env.PORT ?? 3001);
const vitePort = Number(process.env.VITE_PORT ?? 5173);

export default defineConfig({
  server: {
    port: vitePort,
    strictPort: true,
    proxy: {
      // Forward Socket.IO requests and WebSocket upgrades to the separate game server.
      '/socket.io': {
        target: `http://127.0.0.1:${socketPort}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the Three.js engine in its own cached chunk instead of bundling
        // it with the small game and lobby modules.
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
