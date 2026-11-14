import type { JSX } from 'react'

import { TRACKER_VIEWS } from '../../shared/types'
import type { TrackerView } from '../../shared/types'
import { api } from './lib/api'
import { useData } from './lib/data'
import { useRoute } from './lib/router'
import { CompanyScreen } from './screens/Company'
import { EmailDone } from './screens/EmailDone'
import { EmailStart } from './screens/EmailStart'
import { Home } from './screens/Home'
import { HuntStart } from './screens/HuntStart'
import { JobScreen } from './screens/Job'
import { NeverShow } from './screens/NeverShow'
import { Onboarding } from './screens/onboarding/Onboarding'
import { RunScreen } from './screens/run/RunScreen'
import { Runs } from './screens/Runs'
import { Settings } from './screens/settings/Settings'
import { Tracker } from './screens/Tracker'
import { ErrorNote, Loading } from './ui/common'
import { Shell } from './ui/Shell'

function Screen({ route }: { route: string[] }): JSX.Element {
  const [section = 'home', first, second] = route
  switch (section) {
    case 'tracker':
      return <Tracker adding={first === 'new'} view={(TRACKER_VIEWS as readonly string[]).includes(first ?? '') ? (first as TrackerView) : 'all'} />
    case 'job':
      return <JobScreen id={Number(first)} />
    case 'company':
      return <CompanyScreen id={Number(first)} asking={second === 'ask'} />
    case 'hunt':
      return <HuntStart />
    case 'email':
      return first ? <EmailDone runId={Number(first)} /> : <EmailStart />
    case 'run':
      return <RunScreen />
    case 'runs':
      return <Runs selected={first ? Number(first) : null} />
    case 'never-show':
      return <NeverShow />
    case 'settings':
      return <Settings tab={first ?? 'preferences'} sub={second} />
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
    <Shell section={route[0] ?? 'home'}>
      <Screen route={route} />
    </Shell>
  )
}
