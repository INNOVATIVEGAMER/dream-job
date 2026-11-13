import { useState } from 'react'
import type { JSX, ReactNode } from 'react'

import { ArrowsClockwiseIcon, BriefcaseIcon, CheckCircleIcon, FilePdfIcon, TrashIcon, UploadSimpleIcon, WarningIcon } from '@phosphor-icons/react'

import { yearsOfExperience } from '../../../../shared/profile'
import { PORTAL_NAMES, PORTALS } from '../../../../shared/types'
import type { ClaudeStatus, Portal, Preferences, Profile, ResumeImport, Settings, SiteState } from '../../../../shared/types'
import { api } from '../../lib/api'
import { useData } from '../../lib/data'
import { go } from '../../lib/router'
import { useAppStatus } from '../../lib/status'
import { attempt } from '../../ui/common'
import { ListBox, ListRow, Rows, Tags } from '../../ui/fields'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  Button,
  Input,
  Progress,
  Spinner,
  Switch,
  toast,
} from '../../ui/nx'
import { PreferencesForm } from '../settings/PreferencesForm'
import { linkRows, ProjectsList, RolesList } from '../settings/ProfileParts'

const STEPS = 5

const PORTAL_USE: Record<Portal, string> = {
  linkedin: 'Hunt, apply and the referral track',
  wellfound: 'Hunt and apply',
  instahyre: 'Hunt and apply',
}

/** A starter form answer from the resume, edited before it is saved. */
type Starter = { key: number; question: string; answer: string }

type Action = { label: string; onClick: () => void; disabled?: boolean; loading?: boolean }

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

/** One step: a title and a line under it, the body, then Back on the left and the step's actions on the right. */
function Step(props: { title: string; sub: string; children: ReactNode; onBack?: () => void; primary: Action; secondary?: Action; note?: ReactNode }): JSX.Element {
  return (
    <div className="nx:flex nx:flex-col nx:gap-6">
      <div className="nx:flex nx:flex-col nx:gap-2">
        <h1 className="nx:typography-heading-large nx:m-0">{props.title}</h1>
        <span className="nx:typography-body-small nx:text-muted-foreground">{props.sub}</span>
      </div>
      {props.children}
      <div className="nx:flex nx:items-center nx:justify-between nx:gap-2 nx:mt-4">
        {props.onBack ? (
          <Button variant="ghost" onClick={props.onBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="nx:flex nx:items-center nx:gap-2">
          {props.secondary && (
            <Button variant="ghost" disabled={props.secondary.disabled} loading={props.secondary.loading} onClick={props.secondary.onClick}>
              {props.secondary.label}
            </Button>
          )}
          <Button disabled={props.primary.disabled} loading={props.primary.loading} onClick={props.primary.onClick}>
            {props.primary.label}
          </Button>
        </div>
      </div>
      {props.note && <span className="nx:typography-body-small nx:text-muted-foreground nx:text-end">{props.note}</span>}
    </div>
  )
}

function Mark({ ok }: { ok: boolean | null }): JSX.Element {
  if (ok === null) return <Spinner />
  return ok ? <CheckCircleIcon size={18} className="nx:text-success-subtle-foreground" /> : <WarningIcon size={18} className="nx:text-warning-subtle-foreground" />
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

  const check = async (): Promise<void> => {
    setIsChecking(true)
    await attempt(() => api.checkClaude())
    setIsChecking(false)
  }

  return (
    <Step
      title="Sign in with Claude Code"
      sub="Dream Job runs on the Claude Code installed on this Mac, signed in your way. The app never sees your password, token or key."
      primary={{ label: 'Continue', onClick: onNext, disabled: !signedIn }}
      secondary={{ label: 'Check again', onClick: () => void check(), loading: checking }}
      note={
        !checking && !signedIn ? (
          <>
            {state === 'missing' ? 'Install Claude Code, then in' : 'In'} a terminal run <code className="nx:typography-code-inline">claude auth login</code>, then check again.
          </>
        ) : undefined
      }
    >
      <ListBox label="Checks">
        <ListRow
          media={<Mark ok={installed} />}
          title={installed === false ? 'Claude Code is not installed' : 'Claude Code installed'}
          detail={claude?.path ? `${claude.version ? `${claude.version} · ` : ''}${claude.path}` : installed === false ? claude?.message : undefined}
        />
        {installed !== false && <ListRow media={<Mark ok={signedIn} />} title={signedIn === false ? 'Not signed in' : 'Signed in'} detail={checking ? undefined : claude?.message} />}
      </ListBox>
    </Step>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Resume                                                           */
/* ------------------------------------------------------------------ */

function ResumeStep(props: { settings: Settings; found: ResumeImport | null; onFound: (found: ResumeImport | null) => void; onUse: (found: ResumeImport) => void; onSkip: () => void; onBack: () => void }): JSX.Element {
  const resume = props.settings.resume
  const [isReading, setIsReading] = useState(false)
  const found = props.found

  const read = async (): Promise<void> => {
    setIsReading(true)
    const result = await attempt(() => api.settings.importResume())
    setIsReading(false)
    if (result) props.onFound(result)
  }
  const choose = async (): Promise<void> => {
    const chosen = await attempt(() => api.settings.chooseResume())
    if (!chosen) return
    props.onFound(null)
    await read()
  }

  const summary = found
    ? `Read: ${plural(found.profile.roles.length, 'role')}, ${plural(found.profile.skills.length, 'skill')}, ${plural(found.answers.length, 'form answer')}`
    : isReading
      ? 'Claude is reading it. About a minute.'
      : resume
        ? [resume.pages ? plural(resume.pages, 'page') : null, `${Math.round(resume.bytes / 1024)} KB`].filter(Boolean).join(' · ')
        : ''

  return (
    <Step
      title="Add your resume"
      sub="Claude reads it to fill in your profile. It stays on this Mac."
      onBack={props.onBack}
      primary={found ? { label: 'Review what Claude found', onClick: () => props.onUse(found) } : { label: 'Read my resume', onClick: () => void read(), disabled: !resume, loading: isReading }}
      secondary={{ label: 'Fill in by hand', onClick: props.onSkip, disabled: isReading }}
    >
      {resume ? (
        <Attachment>
          <AttachmentMedia variant="icon">{isReading ? <Spinner /> : <FilePdfIcon />}</AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{resume.fileName}</AttachmentTitle>
            <AttachmentDescription>{summary}</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <Button variant="ghost" size="sm" disabled={isReading} onClick={() => void choose()}>
              Use another
            </Button>
          </AttachmentActions>
        </Attachment>
      ) : (
        <div className="nx:flex nx:flex-col nx:items-center nx:gap-3 nx:p-10 nx:rounded-md nx:text-center" style={{ border: '1px dashed var(--nx-color-border-default)' }}>
          <UploadSimpleIcon size={24} />
          <span className="nx:typography-label-default">A PDF of your resume</span>
          <Button variant="outline" size="sm" onClick={() => void choose()}>
            Choose a PDF
          </Button>
        </div>
      )}
    </Step>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Profile                                                          */
/* ------------------------------------------------------------------ */

type Part = 'about' | 'roles' | 'projects' | 'skills' | 'links' | 'answers'

const listed = (names: string[], none: string): string =>
  names.length === 0 ? none : names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`

/** A line of what Claude found, with Edit opening its editor under it. */
function FoundRow(props: { name: string; summary: string; isOpen: boolean; onToggle: () => void; isMissing?: boolean; children: ReactNode }): JSX.Element {
  return (
    <div role="listitem" className="nx:border-b-default nx:border-border-default nx:last:border-b-0">
      <div className="nx:grid nx:items-center nx:gap-3 nx:px-4 nx:py-3" style={{ gridTemplateColumns: '112px minmax(0, 1fr) auto' }}>
        <span className="nx:typography-body-small nx:text-muted-foreground">{props.name}</span>
        <span className={`nx:typography-body-small nx:truncate ${props.isMissing ? 'nx:text-warning-subtle-foreground' : ''}`}>{props.summary}</span>
        <Button variant="ghost" size="sm" aria-expanded={props.isOpen} onClick={props.onToggle}>
          {props.isOpen ? 'Done' : 'Edit'}
        </Button>
      </div>
      {props.isOpen && <div className="nx:px-4 nx:pb-4">{props.children}</div>}
    </div>
  )
}

function ProfileStep(props: { profile: Profile; onProfile: (profile: Profile) => void; starters: Starter[]; onStarters: (starters: Starter[]) => void; onNext: () => void; onBack: () => void }): JSX.Element {
  const { profile, starters } = props
  const set = (patch: Partial<Profile>): void => props.onProfile({ ...profile, ...patch })
  const years = yearsOfExperience(profile)
  const [open, setOpen] = useState<Part | null>(profile.name.trim() ? null : 'about')
  const [isSaving, setIsSaving] = useState(false)
  const toggle = (part: Part): void => setOpen(current => (current === part ? null : part))
  const links = [profile.links.linkedin, profile.links.github, profile.links.site, ...profile.links.other.map(link => link.url)].filter(Boolean)

  const save = async (): Promise<void> => {
    if (!profile.name.trim()) {
      setOpen('about')
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
    <Step
      title="Check what Claude found"
      sub="Every written answer is drawn from this and nothing else. Fix anything wrong; Settings has it later."
      onBack={props.onBack}
      primary={{ label: 'Looks right', onClick: () => void save(), loading: isSaving }}
    >
      <div role="list" aria-label="Your profile" className="nx:rounded-md nx:border-default nx:border-border-default">
        <FoundRow
          name="About you"
          summary={[profile.name, profile.headline, profile.location].filter(Boolean).join(' · ') || 'Your name is missing'}
          isMissing={!profile.name.trim()}
          isOpen={open === 'about'}
          onToggle={() => toggle('about')}
        >
          <Rows
            items={[
              { label: 'Name', id: 'ob-name', control: <Input id="ob-name" value={profile.name} onChange={event => set({ name: event.target.value })} /> },
              { label: 'Headline', id: 'ob-headline', control: <Input id="ob-headline" value={profile.headline} onChange={event => set({ headline: event.target.value })} /> },
              { label: 'Lives in', id: 'ob-location', control: <Input id="ob-location" placeholder="City, country" value={profile.location} onChange={event => set({ location: event.target.value })} /> },
            ]}
          />
        </FoundRow>
        <FoundRow
          name="Experience"
          summary={profile.roles.length ? `${plural(profile.roles.length, 'role')}${years ? `, ${years} years` : ''}: ${listed(profile.roles.map(role => role.company), '')}` : 'None yet'}
          isOpen={open === 'roles'}
          onToggle={() => toggle('roles')}
        >
          <RolesList roles={profile.roles} skills={profile.skills} onChange={roles => set({ roles })} />
        </FoundRow>
        <FoundRow name="Projects" summary={listed(profile.projects.map(project => project.name), 'None yet')} isOpen={open === 'projects'} onToggle={() => toggle('projects')}>
          <ProjectsList projects={profile.projects} onChange={projects => set({ projects })} />
        </FoundRow>
        <FoundRow name="Skills" summary={listed(profile.skills, 'None yet')} isOpen={open === 'skills'} onToggle={() => toggle('skills')}>
          <Tags ariaLabel="Skills" values={profile.skills} onChange={skills => set({ skills })} placeholder="Add a skill" />
        </FoundRow>
        <FoundRow name="Links" summary={links.length ? plural(links.length, 'link') : 'None yet'} isOpen={open === 'links'} onToggle={() => toggle('links')}>
          <Rows items={linkRows(profile.links, next => set({ links: next }))} />
        </FoundRow>
        <FoundRow name="Form answers" summary={listed(starters.map(starter => starter.question), 'None yet: forms ask, you answer once')} isOpen={open === 'answers'} onToggle={() => toggle('answers')}>
          {starters.length === 0 ? (
            <span className="nx:typography-body-small nx:text-muted-foreground">None yet.</span>
          ) : (
            <Rows
              items={starters.map(starter => ({
                label: starter.question,
                id: `starter-${starter.key}`,
                control: (
                  <div className="nx:flex nx:items-center nx:gap-2">
                    <Input
                      id={`starter-${starter.key}`}
                      value={starter.answer}
                      onChange={event => props.onStarters(starters.map(one => (one.key === starter.key ? { ...one, answer: event.target.value } : one)))}
                    />
                    <Button variant="ghost" size="icon-sm" aria-label={`Drop ${starter.question}`} onClick={() => props.onStarters(starters.filter(one => one.key !== starter.key))}>
                      <TrashIcon />
                    </Button>
                  </div>
                ),
              }))}
            />
          )}
        </FoundRow>
      </div>
    </Step>
  )
}

/* ------------------------------------------------------------------ */
/* 4. Preferences                                                      */
/* ------------------------------------------------------------------ */

function SearchStep(props: { prefs: Preferences; onPrefs: (prefs: Preferences) => void; years: number | null; onNext: () => void; onBack: () => void }): JSX.Element {
  const { prefs } = props
  const [isSaving, setIsSaving] = useState(false)
  const problem =
    prefs.targetRoles.length === 0
      ? 'Add at least one role you want.'
      : !prefs.modes.remote && !prefs.modes.hybrid && !prefs.modes.onsite
        ? 'Pick at least one work mode.'
        : (prefs.modes.hybrid || prefs.modes.onsite) && prefs.cities.length === 0 && !prefs.country.trim()
          ? 'Add a city for hybrid and on-site roles.'
          : null

  const save = async (): Promise<void> => {
    setIsSaving(true)
    const saved = await attempt(async () => {
      await api.settings.setPreferences(prefs)
      return true
    })
    setIsSaving(false)
    if (saved) props.onNext()
  }

  return (
    <Step
      title="What you're looking for"
      sub="Suggested from your resume. Settings has the rest."
      onBack={props.onBack}
      primary={{ label: 'Continue', onClick: () => void save(), disabled: !!problem, loading: isSaving }}
      note={problem ?? undefined}
    >
      <PreferencesForm value={prefs} onChange={props.onPrefs} years={props.years} isShort />
    </Step>
  )
}

/* ------------------------------------------------------------------ */
/* 5. Portals and sign-in                                              */
/* ------------------------------------------------------------------ */

function SignIn({ site, onSignIn }: { site: SiteState | undefined; onSignIn: () => void }): JSX.Element {
  if (site?.state === 'signed-in') return <span className="nx:typography-body-small nx:text-muted-foreground">Signed in</span>
  return (
    <Button variant="outline" size="sm" onClick={onSignIn}>
      Sign in
    </Button>
  )
}

function PortalsStep({ settings, onBack }: { settings: Settings; onBack: () => void }): JSX.Element {
  const sites = useData(() => api.settings.sites(), [], ['sites'])
  const info = useData(() => api.chrome.info(), [], [])
  const portals = settings.portals
  const site = (name: string): SiteState | undefined => sites.data?.find(one => one.site === name)
  const anyOn = PORTALS.some(portal => portals[portal].enabled)
  const [finishing, setFinishing] = useState<string | null>(null)

  const finish = async (then: string): Promise<void> => {
    setFinishing(then)
    const done = await attempt(async () => {
      await api.settings.finishSetup()
      return true
    })
    setFinishing(null)
    if (done) go(then)
  }

  return (
    <Step
      title="Sign in to your portals"
      sub="In the app's own Chrome. You type every password, and the sign-ins stay."
      onBack={onBack}
      primary={{ label: 'Start first hunt', onClick: () => void finish('/hunt'), disabled: !anyOn || !!finishing, loading: finishing === '/hunt' }}
      secondary={{ label: 'Finish', onClick: () => void finish('/'), disabled: !anyOn || !!finishing, loading: finishing === '/' }}
      note={anyOn ? undefined : 'Turn on at least one portal.'}
    >
      {info.data && !info.data.chromePath && (
        <Alert variant="warning" layout="inline">
          <AlertIcon>
            <WarningIcon />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>Google Chrome is not installed. Install it in Applications, then sign in here.</AlertDescription>
          </AlertContent>
        </Alert>
      )}
      <ListBox label="Portals">
        {PORTALS.map(portal => (
          <ListRow
            key={portal}
            media={
              <Switch
                size="sm"
                aria-label={`Use ${PORTAL_NAMES[portal]}`}
                checked={portals[portal].enabled}
                onCheckedChange={enabled => void attempt(() => api.settings.setPortals({ ...portals, [portal]: { ...portals[portal], enabled } }))}
              />
            }
            title={PORTAL_NAMES[portal]}
            detail={PORTAL_USE[portal]}
            actions={portals[portal].enabled ? <SignIn site={site(portal)} onSignIn={() => void attempt(() => api.chrome.signIn(portal))} /> : undefined}
          />
        ))}
        <ListRow
          media={
            <Switch
              size="sm"
              aria-label="Use Gmail"
              checked={settings.email.enabled}
              onCheckedChange={enabled => void attempt(() => api.settings.setEmail({ ...settings.email, enabled }))}
            />
          }
          title="Gmail"
          detail="Optional: keeps your tracker up to date"
          actions={settings.email.enabled ? <SignIn site={site('google')} onSignIn={() => void attempt(() => api.chrome.signIn('google'))} /> : undefined}
        />
      </ListBox>
      <div>
        <Button variant="ghost" size="sm" startIcon={<ArrowsClockwiseIcon />} loading={sites.isLoading} onClick={sites.reload}>
          Check sign-ins again
        </Button>
      </div>
    </Step>
  )
}

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

/** First run, one centred step at a time: Claude Code, the resume, the profile it gives, what to look for, then portals. */
export function Onboarding({ settings }: { settings: Settings }): JSX.Element {
  const [step, setStep] = useState(0)
  // Held here so Back keeps what was typed; saved as each step is left.
  const [profile, setProfile] = useState<Profile>(settings.profile)
  const [prefs, setPrefs] = useState<Preferences>(settings.preferences)
  const [starters, setStarters] = useState<Starter[]>([])
  const [found, setFound] = useState<ResumeImport | null>(null)

  const move = (to: number): void => {
    setStep(to)
    window.scrollTo({ top: 0 })
  }

  const takeFound = (result: ResumeImport): void => {
    setProfile(current => ({ ...result.profile, never: current.never }))
    setStarters(result.answers.map((answer, i) => ({ key: i, ...answer })))
    setPrefs(current => {
      const next = { ...current }
      if (next.targetRoles.length === 0) next.targetRoles = result.targetRoles
      if (next.ceilingYears === null && result.years !== null) next.ceilingYears = Math.ceil(result.years) + 2
      // "City, country" from the resume seeds where to look; step 4 shows it.
      const parts = result.profile.location
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
    <div className="nx:min-h-screen nx:flex nx:flex-col nx:bg-background nx:text-foreground">
      <header className="nx:flex nx:items-center nx:justify-between nx:gap-2 nx:px-6 nx:py-4">
        <div className="nx:flex nx:items-center nx:gap-2">
          <span className="nx:inline-flex nx:items-center nx:justify-center nx:size-6 nx:rounded-sm nx:bg-primary-background nx:text-primary-foreground">
            <BriefcaseIcon size={14} />
          </span>
          <span className="nx:typography-label-default">Dream Job</span>
        </div>
        <span className="nx:typography-body-small nx:text-muted-foreground">
          Step {step + 1} of {STEPS}
        </span>
      </header>
      <div className="nx:px-6">
        <Progress aria-label="Setup progress" value={Math.round(((step + 1) / STEPS) * 100)} />
      </div>
      <main className="nx:flex nx:flex-1 nx:justify-center nx:px-6 nx:py-12">
        <div className={`nx:w-full ${step === 2 || step === 3 ? 'nx:max-w-[680px]' : 'nx:max-w-[560px]'}`}>
          {step === 0 && <ClaudeStep onNext={() => move(1)} />}
          {step === 1 && <ResumeStep settings={settings} found={found} onFound={setFound} onUse={takeFound} onSkip={() => move(2)} onBack={() => move(0)} />}
          {step === 2 && <ProfileStep profile={profile} onProfile={setProfile} starters={starters} onStarters={setStarters} onNext={() => move(3)} onBack={() => move(1)} />}
          {step === 3 && <SearchStep prefs={prefs} onPrefs={setPrefs} years={yearsOfExperience(profile)} onNext={() => move(4)} onBack={() => move(2)} />}
          {step === 4 && <PortalsStep settings={settings} onBack={() => move(3)} />}
        </div>
      </main>
    </div>
  )
}
