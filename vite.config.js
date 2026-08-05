import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Increase the limit to 1000 kB (1 MB) or higher
    chunkSizeWarningLimit: 1000,
  },
});
