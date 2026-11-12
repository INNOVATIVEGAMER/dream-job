import type { JSX } from 'react'

import { CURRENCIES, HUNT_WINDOW_NAMES, HUNT_WINDOWS } from '../../../../shared/types'
import type { Currency, HuntWindow, PayPeriod, Preferences } from '../../../../shared/types'
import { ChipsInput } from '../../ui/common'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  NativeSelect,
  NativeSelectOption,
  Switch,
} from '../../ui/nx'

const numberOrNull = (text: string): number | null => {
  const value = Number(text)
  return text.trim() === '' || Number.isNaN(value) ? null : value
}

/** What the user is looking for: used in onboarding and in Settings. */
export function PreferencesForm(props: { value: Preferences; onChange: (value: Preferences) => void; years?: number | null }): JSX.Element {
  const prefs = props.value
  const set = (patch: Partial<Preferences>): void => props.onChange({ ...prefs, ...patch })

  return (
    <div className="nx:flex nx:flex-wrap nx:gap-6 nx:items-start">
      <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 420px' }}>
        <Card className="nx:w-full">
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <CardDescription>Each role you want runs as a search on every portal you use. The kind of company is never a cut.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pref-target">Roles you want</FieldLabel>
                <ChipsInput id="pref-target" values={prefs.targetRoles} onChange={targetRoles => set({ targetRoles })} placeholder="Add a role, then press Enter" />
              </Field>
              <Field>
                <FieldLabel htmlFor="pref-skip">Roles you skip</FieldLabel>
                <ChipsInput id="pref-skip" values={prefs.skipRoles} onChange={skipRoles => set({ skipRoles })} placeholder="Add a kind of role you never want" />
                <FieldDescription>A posting that is mainly one of these is discarded, with the line that shows it.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="pref-ceiling">Most years a posting may ask for</FieldLabel>
                <Input
                  id="pref-ceiling"
                  type="number"
                  min={0}
                  max={60}
                  value={prefs.ceilingYears ?? ''}
                  onChange={event => set({ ceilingYears: numberOrNull(event.target.value) })}
                />
                <FieldDescription>
                  Any level within it is fine. Over it is discarded, unless the match is unusually strong.
                  {props.years ? ` You have about ${props.years} years, from your roles.` : ''}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="pref-window">Hunt postings from</FieldLabel>
                <NativeSelect id="pref-window" value={prefs.window} onChange={event => set({ window: event.target.value as HuntWindow })}>
                  {HUNT_WINDOWS.map(window => (
                    <NativeSelectOption key={window} value={window}>
                      {HUNT_WINDOW_NAMES[window]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
      <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 360px' }}>
        <Card className="nx:w-full">
          <CardHeader>
            <CardTitle>Places and pay</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pref-country">Country</FieldLabel>
                <Input id="pref-country" value={prefs.country} onChange={event => set({ country: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="pref-cities">Cities for on-site and hybrid</FieldLabel>
                <ChipsInput id="pref-cities" values={prefs.cities} onChange={cities => set({ cities })} placeholder="Add a city, then press Enter" />
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Work modes</FieldLegend>
                {(['remote', 'hybrid', 'onsite'] as const).map(mode => (
                  <Field key={mode} orientation="horizontal">
                    <Switch id={`mode-${mode}`} checked={prefs.modes[mode]} onCheckedChange={on => set({ modes: { ...prefs.modes, [mode]: on } })} />
                    <FieldLabel htmlFor={`mode-${mode}`}>{mode === 'onsite' ? 'On-site' : mode[0]!.toUpperCase() + mode.slice(1)}</FieldLabel>
                  </Field>
                ))}
                <Field orientation="horizontal">
                  <Switch id="pref-visa" checked={prefs.needsVisa} onCheckedChange={needsVisa => set({ needsVisa })} />
                  <FieldLabel htmlFor="pref-visa">I need visa sponsorship</FieldLabel>
                </Field>
              </FieldSet>
              <div className="nx:flex nx:flex-wrap nx:gap-3">
                <div className="nx:min-w-0" style={{ flex: '1 1 120px' }}>
                  <Field>
                    <FieldLabel htmlFor="pref-currency">Currency</FieldLabel>
                    <NativeSelect id="pref-currency" value={prefs.currency} onChange={event => set({ currency: event.target.value as Currency })}>
                      {CURRENCIES.map(currency => (
                        <NativeSelectOption key={currency} value={currency}>
                          {currency === 'INR' ? 'INR, in lakh' : currency}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
                <div className="nx:min-w-0" style={{ flex: '1 1 100px' }}>
                  <Field>
                    <FieldLabel htmlFor="pref-floor">Pay floor</FieldLabel>
                    <Input id="pref-floor" type="number" min={0} value={prefs.floor ?? ''} onChange={event => set({ floor: numberOrNull(event.target.value) })} />
                  </Field>
                </div>
                <div className="nx:min-w-0" style={{ flex: '1 1 100px' }}>
                  <Field>
                    <FieldLabel htmlFor="pref-period">Per</FieldLabel>
                    <NativeSelect id="pref-period" value={prefs.period} onChange={event => set({ period: event.target.value as PayPeriod })}>
                      <NativeSelectOption value="year">Year</NativeSelectOption>
                      <NativeSelectOption value="month">Month</NativeSelectOption>
                      <NativeSelectOption value="hour">Hour</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </div>
              </div>
              <FieldDescription>A posting whose band sits below your floor stops and asks you.</FieldDescription>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
