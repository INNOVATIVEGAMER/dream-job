import './nxds.css'
import './app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { defaultAppearance } from './appearance-state'
import { NxdsAppearanceProvider } from './components/nxds/components/appearance/provider'
import { Toaster } from './components/nxds/components/sonner/sonner'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

createRoot(root).render(
  <StrictMode>
    <NxdsAppearanceProvider storageKey="nxds-appearance" defaultState={defaultAppearance}>
      <App />
      <Toaster />
    </NxdsAppearanceProvider>
  </StrictMode>,
)
