import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend binds FRONTEND_ORIGIN=http://localhost:3000 for CORS and cookies.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
  },
  preview: {
    port: 3000,
    strictPort: true,
  },
})
