import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, /api y /uploads se reenvían al backend (en Docker: http://backend:3000).
const backend = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Necesario para detectar cambios en carpetas montadas desde Windows.
    watch: { usePolling: true },
    proxy: { '/api': backend, '/uploads': backend },
  },
});
