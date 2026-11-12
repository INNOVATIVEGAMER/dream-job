import type { JSX } from 'react'

import { api } from './lib/api'
import { useData } from './lib/data'
import { useRoute } from './lib/router'
import { ConnectStart } from './screens/ConnectStart'
import { Contacts } from './screens/Contacts'
import { Discarded } from './screens/Discarded'
import { Home } from './screens/Home'
import { HuntStart } from './screens/HuntStart'
import { Onboarding } from './screens/onboarding/Onboarding'
import { Opportunity } from './screens/Opportunity'
import { ReferralStart } from './screens/ReferralStart'
import { RunScreen } from './screens/run/RunScreen'
import { Runs } from './screens/Runs'
import { Settings } from './screens/settings/Settings'
import { Thanks } from './screens/Thanks'
import { Tracker } from './screens/Tracker'
import { TrackerAdd } from './screens/TrackerAdd'
import { ErrorNote, Loading } from './ui/common'
import { Shell } from './ui/Shell'

function Screen({ route }: { route: string[] }): JSX.Element {
  const [section = 'home', first, second] = route
  switch (section) {
    case 'tracker':
      return first === 'new' ? <TrackerAdd /> : <Tracker />
    case 'opportunity':
      return <Opportunity id={Number(first)} />
    case 'hunt':
      return <HuntStart />
    case 'run':
      return <RunScreen />
    case 'runs':
      return <Runs selected={first ? Number(first) : null} />
    case 'contacts':
      if (first === 'connect') return <ConnectStart />
      if (first === 'message') return <ReferralStart />
      if (first && second === 'thanks') return <Thanks id={Number(first)} />
      return <Contacts />
    case 'discarded':
      return <Discarded tab={first === 'never' ? 'never' : 'discarded'} />
    case 'settings':
      return <Settings tab={first ?? 'preferences'} />
    default:
      return <Home />
  }
}

/** Onboarding until the user finishes it; then the app, one screen at a time. */
export function App(): JSX.Element {
  const settings = useData(() => api.settings.get(), [], ['settings'])
  const route = useRoute()

  if (settings.error) {
    return (
      <div className="nx:p-6">
        <ErrorNote text={`The app could not read its settings: ${settings.error}`} />
      </div>
    )
  }
  if (!settings.data) {
    return (
      <div className="nx:p-6">
        <Loading />
      </div>
    )
  }
  if (!settings.data.isSetUp) return <Onboarding settings={settings.data} />

  return (
    <Shell section={route[0] ?? 'home'} name={settings.data.profile.name}>
      <Screen route={route} />
    </Shell>
  )
}
