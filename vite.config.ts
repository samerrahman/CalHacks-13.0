import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localProviderApi } from './src/integrations/devServer';
export default defineConfig({ plugins: [react(), localProviderApi()], base: './', server: { host: '127.0.0.1', port: 5173, strictPort: true }, build: { chunkSizeWarningLimit: 850 } });
