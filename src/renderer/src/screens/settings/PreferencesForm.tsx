import type { JSX } from 'react'

import { CURRENCIES, HUNT_WINDOW_NAMES, HUNT_WINDOWS, PAY_PERIODS } from '../../../../shared/types'
import type { Currency, HuntWindow, PayPeriod, Preferences } from '../../../../shared/types'
import { Choice, End, MultiSegments, Rows, Tags } from '../../ui/fields'
import { Input, InputGroup, InputGroupAddon, InputGroupInput, InputGroupText, Switch } from '../../ui/nx'

const numberOrNull = (text: string): number | null => {
  const value = Number(text)
  return text.trim() === '' || Number.isNaN(value) ? null : value
}

const MODES = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
]

const PERIOD_NAMES: Record<PayPeriod, string> = { year: 'a year', month: 'a month', hour: 'an hour' }

const ROLE_SUGGESTIONS = ['Frontend Engineer', 'Full Stack Engineer', 'Software Engineer', 'UI Engineer', 'Design Systems Engineer', 'Backend Engineer', 'Mobile Engineer']
const SKIP_SUGGESTIONS = ['Backend only', 'Mobile only', 'QA', 'DevOps', 'Data engineering', 'Sales engineering']

/** The pay floor: currency, amount and period on one line. */
function PayFloor({ prefs, set }: { prefs: Preferences; set: (patch: Partial<Preferences>) => void }): JSX.Element {
  return (
    <div className="nx:grid nx:gap-2 nx:items-center" style={{ gridTemplateColumns: '96px minmax(0, 1fr) 128px' }}>
      <Choice
        ariaLabel="Currency"
        value={prefs.currency}
        options={CURRENCIES.map(currency => ({ value: currency, label: currency }))}
        onChange={currency => set({ currency: currency as Currency })}
      />
      <InputGroup>
        <InputGroupInput
          id="pref-floor"
          type="number"
          min={0}
          aria-label="Pay floor"
          value={prefs.floor ?? ''}
          onChange={event => set({ floor: numberOrNull(event.target.value) })}
        />
        {prefs.currency === 'INR' && prefs.period === 'year' && (
          <InputGroupAddon align="inline-end">
            <InputGroupText>lakh</InputGroupText>
          </InputGroupAddon>
        )}
      </InputGroup>
      <Choice
        ariaLabel="Per"
        value={prefs.period}
        options={PAY_PERIODS.map(period => ({ value: period, label: PERIOD_NAMES[period] }))}
        onChange={period => set({ period: period as PayPeriod })}
      />
    </div>
  )
}

/**
 * What the user is looking for, as rows. Settings shows every row;
 * onboarding (`isShort`) only the ones a resume can't suggest well.
 */
export function PreferencesForm(props: { value: Preferences; onChange: (value: Preferences) => void; years?: number | null; isShort?: boolean }): JSX.Element {
  const prefs = props.value
  const set = (patch: Partial<Preferences>): void => props.onChange({ ...prefs, ...patch })
  const modes = MODES.filter(mode => prefs.modes[mode.value as keyof Preferences['modes']]).map(mode => mode.value)

  const targetRoles = {
    label: 'Target roles',
    id: 'pref-target',
    tip: 'Each runs as a search on every portal you use',
    control: <Tags id="pref-target" ariaLabel="Target roles" values={prefs.targetRoles} suggestions={ROLE_SUGGESTIONS} onChange={targetRoles => set({ targetRoles })} placeholder="Add a role" />,
  }
  const skipRoles = {
    label: 'Roles you skip',
    id: 'pref-skip',
    tip: 'A posting that is mainly one of these is discarded, with the line that shows it',
    control: <Tags id="pref-skip" ariaLabel="Roles you skip" values={prefs.skipRoles} suggestions={SKIP_SUGGESTIONS} onChange={skipRoles => set({ skipRoles })} placeholder="Add a role" />,
  }
  const workModes = {
    label: 'Work modes',
    control: (
      <MultiSegments
        ariaLabel="Work modes"
        values={modes}
        options={MODES}
        onChange={values => set({ modes: { remote: values.includes('remote'), hybrid: values.includes('hybrid'), onsite: values.includes('onsite') } })}
      />
    ),
  }
  const cities = {
    label: 'Cities',
    id: 'pref-cities',
    tip: 'For hybrid and on-site roles',
    control: <Tags id="pref-cities" ariaLabel="Cities" values={prefs.cities} onChange={cities => set({ cities })} placeholder="Add a city" />,
  }
  const floor = {
    label: 'Pay floor',
    id: 'pref-floor',
    tip: 'A posting whose band sits below this stops and asks you',
    control: <PayFloor prefs={prefs} set={set} />,
  }

  if (props.isShort) return <Rows items={[targetRoles, skipRoles, workModes, cities, floor]} />

  return (
    <div className="nx:flex nx:flex-col nx:gap-8">
      <Rows
        title="Roles"
        items={[
          targetRoles,
          skipRoles,
          {
            label: 'Experience ceiling',
            id: 'pref-ceiling',
            tip: `Most years a posting may ask for. Over it is discarded, unless the match is unusually strong.${props.years ? ` You have about ${props.years}, from your roles.` : ''}`,
            control: (
              <InputGroup className="nx:max-w-56">
                <InputGroupInput
                  id="pref-ceiling"
                  type="number"
                  min={0}
                  max={60}
                  value={prefs.ceilingYears ?? ''}
                  onChange={event => set({ ceilingYears: numberOrNull(event.target.value) })}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>years at most</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            ),
          },
          {
            label: 'Hunt postings from',
            id: 'pref-window',
            control: (
              <Choice
                id="pref-window"
                value={prefs.window}
                options={HUNT_WINDOWS.map(window => ({ value: window, label: HUNT_WINDOW_NAMES[window] }))}
                onChange={window => set({ window: window as HuntWindow })}
              />
            ),
          },
        ]}
      />
      <Rows
        title="Places and pay"
        items={[
          workModes,
          { label: 'Country', id: 'pref-country', control: <Input id="pref-country" value={prefs.country} onChange={event => set({ country: event.target.value })} /> },
          cities,
          {
            label: 'Needs visa sponsorship',
            id: 'pref-visa',
            control: (
              <End>
                <Switch id="pref-visa" checked={prefs.needsVisa} onCheckedChange={needsVisa => set({ needsVisa })} />
              </End>
            ),
          },
          floor,
        ]}
      />
    </div>
  )
}
