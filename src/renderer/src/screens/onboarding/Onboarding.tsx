import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

import {
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  BriefcaseIcon,
  CheckCircleIcon,
  CircleHalfIcon,
  CircleIcon,
  FilePdfIcon,
  GoogleLogoIcon,
  PlayIcon,
  SignInIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningIcon,
} from '@phosphor-icons/react'

import { yearsOfExperience } from '../../../../shared/profile'
import { PORTAL_NAMES, PORTALS } from '../../../../shared/types'
import type { ClaudeStatus, Portal, Preferences, Profile, ResumeImport, Settings, SiteState } from '../../../../shared/types'
import { api } from '../../lib/api'
import { useData } from '../../lib/data'
import { go } from '../../lib/router'
import { useAppStatus } from '../../lib/status'
import { attempt, ChipsInput, Loading } from '../../ui/common'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  Spinner,
  Switch,
  toast,
} from '../../ui/nx'
import { PreferencesForm } from '../settings/PreferencesForm'
import { LinksEditor, ProjectsList, RolesList } from '../settings/ProfileParts'

const STEPS = ['Claude Code', 'Your resume', 'Review your profile', "What you're looking for", 'Portals and sign-in'] as const

const PORTAL_ABOUT: Record<Portal, string> = {
  linkedin: 'Finds jobs, applies with Easy Apply, and runs the referral track: connection requests and your referral message.',
  wellfound: 'Startup roles. Finds jobs and applies with a note to the company.',
  instahyre: 'Roles in India, matched to your profile. Finds jobs and applies in one step.',
}

/** A starter form answer from the resume, edited before it is saved. */
type Starter = { key: number; question: string; answer: string }

type Read = { found: ResumeImport; seconds: number }

function StepNav({ step }: { step: number }): JSX.Element {
  return (
    <nav aria-label="Setup steps" className="nx:min-w-0" style={{ flex: '1 1 220px' }}>
      <ol className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-1">
        {STEPS.map((name, i) => (
          <li
            key={name}
            aria-current={i === step ? 'step' : undefined}
            className={`nx:flex nx:items-center nx:gap-2 nx:px-3 nx:py-2 nx:rounded-md ${i === step ? 'nx:bg-muted' : ''} ${i > step ? 'nx:text-muted-foreground' : ''}`}
          >
            {i < step ? <CheckCircleIcon /> : i === step ? <CircleHalfIcon /> : <CircleIcon />}
            <span className={i === step ? 'nx:typography-label-default' : 'nx:typography-body-small'}>
              {i + 1}. {name}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function StepHeader({ title, description }: { title: string; description: ReactNode }): JSX.Element {
  return (
    <PageHeader>
      <PageHeaderContent>
        <PageHeaderTitle className="nx:typography-heading-large">{title}</PageHeaderTitle>
        <PageHeaderDescription>{description}</PageHeaderDescription>
      </PageHeaderContent>
    </PageHeader>
  )
}

function Buttons({ children }: { children: ReactNode }): JSX.Element {
  return <div className="nx:flex nx:flex-wrap nx:gap-2">{children}</div>
}

function CheckRow({ isOk, title, detail }: { isOk: boolean | null; title: string; detail?: ReactNode }): JSX.Element {
  return (
    <li className="nx:flex nx:gap-3 nx:items-start">
      {isOk === null ? <Spinner /> : isOk ? <CheckCircleIcon size={20} /> : <WarningIcon size={20} />}
      <div className="nx:flex nx:flex-col nx:gap-1">
        <span className="nx:typography-label-default">{title}</span>
        {detail && <span className="nx:typography-body-small nx:text-muted-foreground">{detail}</span>}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* 1. Claude Code                                                      */
/* ------------------------------------------------------------------ */

function ClaudeStep({ onNext }: { onNext: () => void }): JSX.Element {
  const claude: ClaudeStatus | undefined = useAppStatus()?.claude
  const [isChecking, setIsChecking] = useState(false)
  const checking = !claude || claude.state === 'checking' || isChecking
  const state = claude?.state
  const installed = checking ? null : state !== 'missing'
  const signedIn = checking ? null : state === 'ok' || state === 'api-key' || state === 'other-provider'
  const onPlan = checking ? null : state === 'ok'

  const check = async (): Promise<void> => {
    setIsChecking(true)
    await attempt(() => api.checkClaude())
    setIsChecking(false)
  }

  return (
    <>
      <StepHeader
        title="Sign in with your own Claude Code"
        description="Job App runs on your Claude plan, through Claude Code installed on this Mac. You sign in to Claude Code yourself. The app never sees your password or token."
      />
      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" startIcon={<ArrowsClockwiseIcon />} loading={checking} onClick={() => void check()}>
              Check again
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-3">
            <CheckRow
              isOk={installed}
              title={installed === false ? 'Claude Code is not installed' : 'Claude Code is installed'}
              detail={claude?.path ? `${claude.version ? `Version ${claude.version}, at ` : 'At '}${claude.path}` : installed === false ? claude?.message : undefined}
            />
            {installed !== false && (
              <CheckRow
                isOk={signedIn}
                title={signedIn === false ? 'Not signed in' : 'Signed in'}
                detail={claude?.account?.email ? `As ${claude.account.email}` : signedIn === false ? claude?.message : undefined}
              />
            )}
            {signedIn !== false && installed !== false && (
              <CheckRow
                isOk={onPlan}
                title={onPlan === false ? 'Not on a Claude plan' : 'On a Claude plan, not an API key'}
                detail={
                  onPlan
                    ? `Runs use ${claude?.account?.subscriptionType ? `your ${claude.account.subscriptionType} plan` : 'your plan'}. An API key in your environment is ignored.`
                    : onPlan === false
                      ? claude?.message
                      : undefined
                }
              />
            )}
          </ul>
        </CardContent>
        <CardFooter>
          <Button endIcon={<ArrowRightIcon />} disabled={!onPlan} onClick={onNext}>
            Continue
          </Button>
        </CardFooter>
      </Card>
      {!checking && !onPlan && (
        <Card>
          <CardHeader>
            <CardTitle>Not set up yet?</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="nx:typography-body-default nx:m-0 nx:pl-5 nx:flex nx:flex-col nx:gap-2">
              {state === 'missing' && <li>Install Claude Code on this Mac.</li>}
              <li>
                In a terminal, run <code className="nx:typography-code-inline">claude auth login</code> and sign in with your Claude account, not an API key.
              </li>
              <li>Come back here and press Check again.</li>
            </ol>
          </CardContent>
        </Card>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Resume                                                           */
/* ------------------------------------------------------------------ */

function ResumeStep(props: {
  settings: Settings
  read: Read | null
  onRead: (read: Read | null) => void
  onUse: (found: ResumeImport) => void
  onSkip: () => void
  onBack: () => void
}): JSX.Element {
  const resume = props.settings.resume
  const [isReading, setIsReading] = useState(false)

  const read = async (): Promise<void> => {
    setIsReading(true)
    const started = Date.now()
    const found = await attempt(() => api.settings.importResume())
    setIsReading(false)
    if (found) props.onRead({ found, seconds: Math.max(1, Math.round((Date.now() - started) / 1000)) })
  }
  const choose = async (): Promise<void> => {
    const chosen = await attempt(() => api.settings.chooseResume())
    if (!chosen) return
    props.onRead(null)
    await read()
  }

  const found = props.read?.found
  const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

  return (
    <>
      <StepHeader
        title="Add your resume"
        description="Claude reads it to fill in your profile, the roles you're after and a first set of form answers. You check everything in the next step."
      />
      {resume ? (
        <Item variant="outline">
          <ItemMedia variant="icon">
            <FilePdfIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{resume.fileName}</ItemTitle>
            <ItemDescription>
              {resume.pages ? `${plural(resume.pages, 'page')}, ` : ''}
              {Math.round(resume.bytes / 1024)} KB
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="ghost" size="sm" disabled={isReading} onClick={() => void choose()}>
              Use a different PDF
            </Button>
          </ItemActions>
        </Item>
      ) : (
        <div className="nx:flex nx:flex-col nx:items-center nx:gap-3 nx:p-8 nx:rounded-md nx:text-center" style={{ border: '1px dashed var(--nx-color-border-default)' }}>
          <UploadSimpleIcon size={24} />
          <span className="nx:typography-label-default">Choose your resume</span>
          <span className="nx:typography-body-small nx:text-muted-foreground">A PDF. Claude starts reading it as soon as you pick it.</span>
          <Button onClick={() => void choose()}>Choose a PDF</Button>
        </div>
      )}

      {isReading && (
        <Card>
          <CardContent>
            <Loading label="Claude is reading your resume. This takes about a minute." />
          </CardContent>
        </Card>
      )}

      {!isReading && resume && !found && (
        <Card>
          <CardHeader>
            <CardTitle>Read it with Claude</CardTitle>
            <CardDescription>Uses your Claude plan. Claude may open this one file and nothing else.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Buttons>
              <Button onClick={() => void read()}>Read my resume</Button>
              <Button variant="ghost" onClick={props.onBack}>
                Back
              </Button>
            </Buttons>
          </CardFooter>
        </Card>
      )}

      {!isReading && found && (
        <Card>
          <CardHeader>
            <CardTitle>Claude read your resume</CardTitle>
            <CardDescription>Took {plural(props.read!.seconds, 'second')} on your Claude plan.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="nx:m-0 nx:p-0 nx:list-none nx:flex nx:flex-col nx:gap-3 nx:typography-body-default">
              {[
                `${plural(found.profile.roles.length, 'role')}, with companies, dates and what you built`,
                `${plural(found.profile.skills.length, 'skill')} and ${plural(found.profile.projects.length, 'project')}`,
                `${plural([found.profile.links.linkedin, found.profile.links.github, found.profile.links.site].filter(Boolean).length + found.profile.links.other.length, 'public link')}`,
                found.targetRoles.length > 0 ? 'Suggested target roles, from your recent titles' : 'No target roles suggested: you add them in step 4',
                `${plural(found.answers.length, 'starter form answer')}`,
              ].map(line => (
                <li key={line} className="nx:flex nx:gap-3 nx:items-center">
                  <CheckCircleIcon />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Buttons>
              <Button endIcon={<ArrowRightIcon />} onClick={() => props.onUse(found)}>
                Review what Claude found
              </Button>
              <Button variant="ghost" onClick={props.onBack}>
                Back
              </Button>
            </Buttons>
          </CardFooter>
        </Card>
      )}

      <p className="nx:typography-body-small nx:m-0 nx:text-muted-foreground">
        Your resume stays on this Mac, in the app's data folder. It's attached to applications and referral messages later. No resume to hand?{' '}
        <Button variant="link" size="sm" className="nx:p-0 nx:h-auto" onClick={props.onSkip}>
          Skip this and fill your profile in by hand.
        </Button>
      </p>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Profile                                                          */
/* ------------------------------------------------------------------ */

function ProfileStep(props: {
  profile: Profile
  onProfile: (profile: Profile) => void
  starters: Starter[]
  onStarters: (starters: Starter[]) => void
  onNext: () => void
  onBack: () => void
}): JSX.Element {
  const { profile, starters } = props
  const set = (patch: Partial<Profile>): void => props.onProfile({ ...profile, ...patch })
  const years = yearsOfExperience(profile)
  const [isSaving, setIsSaving] = useState(false)

  const save = async (): Promise<void> => {
    if (!profile.name.trim()) {
      toast.error('Enter your name.')
      return
    }
    setIsSaving(true)
    const saved = await attempt(async () => {
      await api.settings.setProfile(profile)
      for (const starter of starters) {
        if (starter.question.trim() && starter.answer.trim()) await api.settings.saveAnswer(starter.question, starter.answer)
      }
      return true
    })
    setIsSaving(false)
    if (saved) props.onNext()
  }

  return (
    <>
      <StepHeader
        title="Check what Claude found"
        description="This becomes your profile: every written answer is drawn from it and nothing else. Fix anything that's wrong or missing."
      />
      <Card>
        <CardHeader>
          <CardTitle>About you</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="nx:flex nx:flex-wrap nx:gap-3">
            <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
              <Field>
                <FieldLabel htmlFor="ob-name">Name</FieldLabel>
                <Input id="ob-name" value={profile.name} onChange={event => set({ name: event.target.value })} />
              </Field>
            </div>
            <div className="nx:min-w-0" style={{ flex: '2 1 280px' }}>
              <Field>
                <FieldLabel htmlFor="ob-headline">Headline</FieldLabel>
                <Input id="ob-headline" value={profile.headline} onChange={event => set({ headline: event.target.value })} />
              </Field>
            </div>
            <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
              <Field>
                <FieldLabel htmlFor="ob-location">Lives in</FieldLabel>
                <Input id="ob-location" placeholder="City, country" value={profile.location} onChange={event => set({ location: event.target.value })} />
              </Field>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Experience</CardTitle>
          <CardDescription>
            {profile.roles.length > 0 ? `${profile.roles.length} ${profile.roles.length === 1 ? 'role' : 'roles'}. ` : ''}Each is used only as written here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RolesList roles={profile.roles} skills={profile.skills} onChange={roles => set({ roles })} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectsList projects={profile.projects} onChange={projects => set({ projects })} />
        </CardContent>
      </Card>
      <div className="nx:flex nx:flex-wrap nx:gap-5">
        <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 300px' }}>
          <Card className="nx:w-full">
            <CardHeader>
              <CardTitle>Skills</CardTitle>
            </CardHeader>
            <CardContent>
              <ChipsInput values={profile.skills} onChange={skills => set({ skills })} placeholder="Add a skill" />
            </CardContent>
          </Card>
        </div>
        <div className="nx:flex nx:min-w-0" style={{ flex: '1 1 300px' }}>
          <Card className="nx:w-full">
            <CardHeader>
              <CardTitle>Links</CardTitle>
            </CardHeader>
            <CardContent>
              <LinksEditor links={profile.links} onChange={links => set({ links })} />
            </CardContent>
          </Card>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Starter form answers</CardTitle>
          <CardDescription>
            Facts forms ask for. Saved to Settings, Form answers, and added to as forms ask new questions.
            {years !== null ? ` Total years, ${years}, is worked out from your roles each time.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {starters.length === 0 ? (
            <span className="nx:typography-body-small nx:text-muted-foreground">None yet. Forms ask, and you answer once.</span>
          ) : (
            <div className="nx:flex nx:flex-col nx:gap-3">
              {starters.map(starter => (
                <div key={starter.key} className="nx:flex nx:flex-wrap nx:gap-2 nx:items-end">
                  <div className="nx:min-w-0" style={{ flex: '1 1 200px' }}>
                    <Field>
                      <FieldLabel htmlFor={`starter-${starter.key}`}>{starter.question}</FieldLabel>
                      <Input
                        id={`starter-${starter.key}`}
                        value={starter.answer}
                        onChange={event => props.onStarters(starters.map(one => (one.key === starter.key ? { ...one, answer: event.target.value } : one)))}
                      />
                    </Field>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Drop ${starter.question}`}
                    onClick={() => props.onStarters(starters.filter(one => one.key !== starter.key))}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Buttons>
        <Button endIcon={<ArrowRightIcon />} loading={isSaving} onClick={() => void save()}>
          Looks right, continue
        </Button>
        <Button variant="ghost" onClick={props.onBack}>
          Back
        </Button>
      </Buttons>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 4. Preferences                                                      */
/* ------------------------------------------------------------------ */

function SearchStep(props: { prefs: Preferences; onPrefs: (prefs: Preferences) => void; years: number | null; onNext: () => void; onBack: () => void }): JSX.Element {
  const { prefs } = props
  const problem =
    prefs.targetRoles.length === 0
      ? 'Add at least one role you want.'
      : !prefs.modes.remote && !prefs.modes.hybrid && !prefs.modes.onsite
        ? 'Turn on at least one work mode.'
        : (prefs.modes.hybrid || prefs.modes.onsite) && prefs.cities.length === 0 && !prefs.country.trim()
          ? 'Add a country or a city for hybrid and on-site roles.'
          : null

  const save = async (): Promise<void> => {
    if (problem) {
      toast.error(problem)
      return
    }
    const saved = await attempt(async () => {
      await api.settings.setPreferences(prefs)
      return true
    })
    if (saved) props.onNext()
  }

  return (
    <>
      <StepHeader title="What you're looking for" description="The hunt searches and scores against these. Suggestions come from your resume; change anything." />
      <PreferencesForm value={prefs} onChange={props.onPrefs} years={props.years} />
      <Buttons>
        <Button endIcon={<ArrowRightIcon />} onClick={() => void save()}>
          Continue
        </Button>
        <Button variant="ghost" onClick={props.onBack}>
          Back
        </Button>
      </Buttons>
      {problem && <span className="nx:typography-body-small nx:text-muted-foreground">{problem}</span>}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 5. Portals and sign-in                                              */
/* ------------------------------------------------------------------ */

function SignInState({ site, onSignIn }: { site: SiteState | undefined; onSignIn: () => void }): JSX.Element {
  if (site?.state === 'signed-in') {
    return (
      <Badge variant="success" fill="light" isCaps={false} leftIcon={<CheckCircleIcon />}>
        Signed in
      </Badge>
    )
  }
  return (
    <Button variant="outline" size="sm" startIcon={<SignInIcon />} onClick={onSignIn}>
      Sign in
    </Button>
  )
}

function PortalsStep({ settings, onBack }: { settings: Settings; onBack: () => void }): JSX.Element {
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const info = useData(() => api.chrome.info(), [], [])
  const browser = useAppStatus()?.browser
  const portals = settings.portals
  const site = (name: string): SiteState | undefined => sites.data?.find(one => one.site === name)
  const anyOn = PORTALS.some(portal => portals[portal].enabled)
  const [isFinishing, setIsFinishing] = useState(false)

  const finish = async (then: string): Promise<void> => {
    setIsFinishing(true)
    const done = await attempt(async () => {
      await api.settings.finishSetup()
      return true
    })
    setIsFinishing(false)
    if (done) go(then)
  }

  return (
    <>
      <StepHeader
        title="Pick your portals and sign in"
        description="Chrome opens with the app's own profile and no control link, so sites accept your sign-in. You type every password yourself; the sign-ins stay."
      />
      {info.data && !info.data.chromePath && (
        <Alert variant="warning" layout="inline">
          <AlertIcon>
            <WarningIcon />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Google Chrome is not installed</AlertTitle>
            <AlertDescription>The app drives your installed Chrome. Install it in Applications, then sign in here.</AlertDescription>
          </AlertContent>
        </Alert>
      )}
      <Item variant="outline">
        <ItemMedia variant="icon">
          <GoogleLogoIcon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Google, first</ItemTitle>
          <ItemDescription>Needed only if you use Continue with Google on a portal.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <SignInState site={site('google')} onSignIn={() => void attempt(() => api.chrome.signIn('google'))} />
        </ItemActions>
      </Item>
      <ItemGroup className="nx:gap-3">
        {PORTALS.map(portal => (
          <Item key={portal} variant="outline">
            <ItemMedia>
              <Switch
                aria-label={`Use ${PORTAL_NAMES[portal]}`}
                checked={portals[portal].enabled}
                onCheckedChange={enabled => void attempt(() => api.settings.setPortals({ ...portals, [portal]: { ...portals[portal], enabled } }))}
              />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{PORTAL_NAMES[portal]}</ItemTitle>
              <ItemDescription>{PORTAL_ABOUT[portal]}</ItemDescription>
            </ItemContent>
            <ItemActions>
              {portals[portal].enabled ? (
                <SignInState site={site(portal)} onSignIn={() => void attempt(() => api.chrome.signIn(portal))} />
              ) : (
                <Badge variant="secondary" fill="light" isCaps={false}>
                  Off
                </Badge>
              )}
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <div className="nx:flex nx:flex-wrap nx:items-center nx:gap-3">
        <Button variant="ghost" size="sm" startIcon={<ArrowsClockwiseIcon />} loading={sites.isLoading} onClick={sites.reload}>
          Check sign-ins again
        </Button>
        <span className="nx:typography-body-small nx:text-muted-foreground">
          {browser?.mode === 'signin' ? 'Chrome saves a new sign-in within a minute, or when you close it.' : 'Sign-ins are read from the app\'s Chrome profile.'}
        </span>
      </div>
      <Alert variant="information" layout="inline">
        <AlertIcon>
          <SlidersHorizontalIcon />
        </AlertIcon>
        <AlertContent>
          <AlertTitle>You decide what Claude may do on each portal</AlertTitle>
          <AlertDescription>Every tool starts on. Turn any off in Settings, Portals; a step that needs one is then handed to you.</AlertDescription>
        </AlertContent>
      </Alert>
      <Buttons>
        <Button startIcon={<PlayIcon />} disabled={!anyOn} loading={isFinishing} onClick={() => void finish('/hunt')}>
          Finish and start the first hunt
        </Button>
        <Button variant="outline" disabled={!anyOn || isFinishing} onClick={() => void finish('/')}>
          Finish
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </Buttons>
      {!anyOn && <span className="nx:typography-body-small nx:text-muted-foreground">Turn on at least one portal.</span>}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

/** First run: Claude Code, the resume, the profile it gives, what to look for, then portals and sign-in. */
export function Onboarding({ settings }: { settings: Settings }): JSX.Element {
  const [step, setStep] = useState(0)
  // Held here so Back keeps what was typed; saved as each step is left.
  const [profile, setProfile] = useState<Profile>(settings.profile)
  const [prefs, setPrefs] = useState<Preferences>(settings.preferences)
  const [starters, setStarters] = useState<Starter[]>([])
  const [read, setRead] = useState<Read | null>(null)

  const move = (to: number): void => {
    setStep(to)
    window.scrollTo({ top: 0 })
  }

  const takeFound = (found: ResumeImport): void => {
    setProfile(current => ({ ...found.profile, never: current.never }))
    setStarters(found.answers.map((answer, i) => ({ key: i, ...answer })))
    setPrefs(current => {
      const next = { ...current }
      if (next.targetRoles.length === 0) next.targetRoles = found.targetRoles
      if (next.ceilingYears === null && found.years !== null) next.ceilingYears = Math.ceil(found.years) + 2
      // "City, country" from the resume seeds where to look; step 4 shows it.
      const parts = found.profile.location
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
      if (!next.country && parts.length > 1) next.country = parts[parts.length - 1]!
      if (next.cities.length === 0 && parts.length > 1) next.cities = [parts[0]!]
      return next
    })
    move(2)
  }

  return (
    <div className="nx:min-h-screen nx:bg-background nx:text-foreground">
      <header className="nx:flex nx:flex-wrap nx:items-center nx:justify-between nx:gap-2 nx:px-6 nx:py-3" style={{ borderBottom: '1px solid var(--nx-color-border-default)' }}>
        <div className="nx:flex nx:items-center nx:gap-2">
          <span className="nx:inline-flex nx:items-center nx:justify-center nx:size-7 nx:rounded-md nx:bg-primary-background nx:text-primary-foreground">
            <BriefcaseIcon />
          </span>
          <span className="nx:typography-label-default">Job App</span>
        </div>
        <span className="nx:typography-body-small nx:text-muted-foreground">
          Setting up, step {step + 1} of {STEPS.length}
        </span>
      </header>
      <div className="nx:box-border nx:w-full nx:max-w-[1080px] nx:mx-auto nx:px-6 nx:py-8 nx:flex nx:flex-wrap nx:gap-8 nx:items-start">
        <StepNav step={step} />
        <main className="nx:min-w-0 nx:flex nx:flex-col nx:gap-5" style={{ flex: '999 1 560px' }}>
          {step === 0 && <ClaudeStep onNext={() => move(1)} />}
          {step === 1 && <ResumeStep settings={settings} read={read} onRead={setRead} onUse={takeFound} onSkip={() => move(2)} onBack={() => move(0)} />}
          {step === 2 && <ProfileStep profile={profile} onProfile={setProfile} starters={starters} onStarters={setStarters} onNext={() => move(3)} onBack={() => move(1)} />}
          {step === 3 && <SearchStep prefs={prefs} onPrefs={setPrefs} years={yearsOfExperience(profile)} onNext={() => move(4)} onBack={() => move(2)} />}
          {step === 4 && <PortalsStep settings={settings} onBack={() => move(3)} />}
        </main>
      </div>
    </div>
  )
}
