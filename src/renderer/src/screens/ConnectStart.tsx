import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { InfoIcon, PlayIcon } from '@phosphor-icons/react'

import { api } from '../lib/api'
import { useData } from '../lib/data'
import { day } from '../lib/format'
import { go } from '../lib/router'
import { useAppStatus } from '../lib/status'
import { attempt, Columns, Hidden, Loading, Page, Section } from '../ui/common'
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  NativeSelect,
  NativeSelectOption,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/nx'

/** Starts a connection-request run: which companies, and how many people at each. */
export function ConnectStart(): JSX.Element {
  const status = useAppStatus()
  const applied = useData(() => api.contacts.applied(), [], ['contacts', 'opportunities'])
  const [picked, setPicked] = useState<string[]>([])
  const [perCompany, setPerCompany] = useState(10)
  const isBusy = status?.run?.status === 'running' || status?.run?.status === 'waiting'

  // Companies with no requests yet start picked.
  useEffect(() => {
    if (applied.data) setPicked(applied.data.filter(company => company.total === 0).map(company => company.company))
  }, [applied.data])

  const start = async (): Promise<void> => {
    if (await attempt(() => api.flows.connect({ companies: picked, perCompany }))) go('/run')
  }

  return (
    <Page
      back={{ label: 'Contacts', to: '/contacts' }}
      title="Send connection requests"
      description="Blank requests on LinkedIn, with no note, to people in your field at the companies you pick. Nobody gets a message until they accept."
      actions={
        <Button startIcon={<PlayIcon />} disabled={isBusy || picked.length === 0} onClick={() => void start()}>
          Send to {picked.length} {picked.length === 1 ? 'company' : 'companies'}
        </Button>
      }
    >
      <Columns
        main={
          <Section title="Companies you applied to">
            {!applied.data ? (
              <Loading />
            ) : applied.data.length === 0 ? (
              <span className="nx:typography-body-small nx:text-muted-foreground">No applications yet. Apply first, then connect.</span>
            ) : (
              <Table aria-label="Companies to connect at" density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Hidden>Include</Hidden>
                    </TableHead>
                    <TableHead>Company and role</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>Requests so far</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applied.data.map(company => (
                    <TableRow key={company.company}>
                      <TableCell>
                        <Switch
                          size="sm"
                          aria-label={`Include ${company.company}`}
                          checked={picked.includes(company.company)}
                          onCheckedChange={on => setPicked(current => (on ? [...current, company.company] : current.filter(one => one !== company.company)))}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="nx:flex nx:flex-col">
                          <span className="nx:typography-label-default">{company.company}</span>
                          <span className="nx:typography-body-small nx:text-muted-foreground">{company.role}</span>
                        </div>
                      </TableCell>
                      <TableCell className="nx:tabular-nums">{day(company.appliedOn)}</TableCell>
                      <TableCell>
                        {company.total === 0 ? 'None yet' : `${company.pending} pending${company.accepted ? `, ${company.accepted} accepted` : ''}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        }
        side={
          <>
            <Card>
              <CardHeader>
                <CardTitle>Who and how many</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="connect-count">Requests per company</FieldLabel>
                    <NativeSelect id="connect-count" value={String(perCompany)} onChange={event => setPerCompany(Number(event.target.value))}>
                      <NativeSelectOption value="5">Up to 5</NativeSelectOption>
                      <NativeSelectOption value="10">Up to 10</NativeSelectOption>
                      <NativeSelectOption value="20">Up to 20</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel>People</FieldLabel>
                    <FieldDescription>
                      People in your field at the company, matched to your target roles and closest to the role first, and its recruiters. For an undisclosed client, the recruiter who posted it.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
            <Alert variant="information" layout="stack">
              <AlertIcon>
                <InfoIcon />
              </AlertIcon>
              <AlertTitle>LinkedIn's weekly limit</AlertTitle>
              <AlertDescription>LinkedIn limits how many invitations go out a week. When it says the limit is reached, the run stops and keeps what was sent.</AlertDescription>
            </Alert>
          </>
        }
      />
    </Page>
  )
}
