import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

import { nxdsAppearance } from './nxds.vite'

/**
 * Every process is bundled with what it uses, so the packaged app carries no
 * node_modules. That also keeps out the Agent SDK's platform package, a copy
 * of Claude Code the app never runs: it runs the user's own install.
 */
export default defineConfig({
  main: { build: { externalizeDeps: false } },
  preload: { build: { externalizeDeps: false } },
  renderer: {
    plugins: [react(), tailwindcss(), nxdsAppearance()],
  },
})
