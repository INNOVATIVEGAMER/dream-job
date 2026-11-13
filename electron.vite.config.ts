import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import license from 'rollup-plugin-license'

import { nxdsAppearance } from './nxds.vite'

/**
 * Every process is bundled with what it uses, so the packaged app carries no
 * node_modules. That also keeps out the Agent SDK's platform package, a copy
 * of Claude Code the app never runs: it runs the user's own install.
 */
/**
 * The licenses of every open-source package bundled into one process, written
 * beside its code, so they travel with every copy of the app as their
 * licenses ask.
 */
const notices = (process: 'main' | 'preload' | 'renderer') =>
  license({ thirdParty: { includePrivate: false, output: { file: resolve(__dirname, 'out', process, 'THIRD_PARTY_NOTICES.txt') } } })

export default defineConfig({
  main: { build: { externalizeDeps: false, rollupOptions: { plugins: [notices('main')] } } },
  preload: { build: { externalizeDeps: false, rollupOptions: { plugins: [notices('preload')] } } },
  renderer: {
    plugins: [react(), tailwindcss(), nxdsAppearance()],
    build: { rollupOptions: { plugins: [notices('renderer')] } },
  },
})
