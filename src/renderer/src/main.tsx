import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { TrackerScreen } from './Tracker'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

// One renderer, two screens: the tracker's window loads it with #tracker.
const isTracker = window.location.hash === '#tracker'
document.title = isTracker ? 'Tracker' : 'Job App'

createRoot(root).render(<StrictMode>{isTracker ? <TrackerScreen /> : <App />}</StrictMode>)
