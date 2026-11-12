import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'

import { STATUSES } from '../../shared/types'
import type { TrackerPage } from '../../shared/types'

const EMPTY: TrackerPage = { rows: [], total: 0, all: 0, counts: {}, page: 0, pages: 1, pageSize: 15 }

/** The tracker: every opportunity in data/job.db, a page at a time, with statuses that save. */
export function TrackerScreen(): JSX.Element {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<TrackerPage>(EMPTY)
  const [note, setNote] = useState<{ text: string; isError: boolean } | null>(null)

  const load = useCallback(async (nextFilter: string, nextPage: number) => {
    try {
      const result = await window.jobApp.trackerPage(nextFilter, nextPage)
      setData(result)
      setPage(result.page)
    } catch (error) {
      setNote({ text: `Could not read the tracker: ${error instanceof Error ? error.message : String(error)}`, isError: true })
    }
  }, [])

  // Loads on a filter change, from its first page; paging calls load itself.
  useEffect(() => {
    void load(filter, 0)
  }, [filter, load])

  const changeStatus = async (id: number, company: string, status: string): Promise<void> => {
    try {
      await window.jobApp.setStatus(id, status)
      setNote({ text: `${company} set to ${status}. Saved.`, isError: false })
      await load(filter, page)
    } catch (error) {
      setNote({ text: `Not saved: ${error instanceof Error ? error.message : String(error)}`, isError: true })
    }
  }

  const first = data.total === 0 ? 0 : data.page * data.pageSize + 1
  const last = data.page * data.pageSize + data.rows.length

  return (
    <main className="tracker">
      <header className="tracker-head">
        <div>
          <h1>Tracker</h1>
          <p className="muted">{data.all} opportunities in job.db</p>
        </div>
        <div className="row">
          <label className="filter">
            <span>Show</span>
            <select
              value={filter}
              onChange={event => {
                setPage(0)
                setFilter(event.target.value)
              }}
            >
              <option value="all">all ({data.all})</option>
              {STATUSES.map(status => (
                <option key={status} value={status}>
                  {status} ({data.counts[status] ?? 0})
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void load(filter, page)}>
            Refresh
          </button>
        </div>
      </header>

      {note && <p className={note.isError ? 'error' : 'saved'}>{note.text}</p>}

      <table className="tracker-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Role</th>
            <th>Stage</th>
            <th className="num">Score</th>
            <th>Status</th>
            <th>Last touch</th>
            <th>Posting</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => (
            <tr key={row.id}>
              <td className="strong">{row.company}</td>
              <td title={row.nextAction ? `Next: ${row.nextAction}` : undefined}>{row.role}</td>
              <td>{row.stage}</td>
              <td className="num">{row.score ?? '-'}</td>
              <td>
                <select
                  aria-label={`Status for ${row.company}`}
                  value={row.status}
                  onChange={event => void changeStatus(row.id, row.company, event.target.value)}
                >
                  {!(STATUSES as readonly string[]).includes(row.status) && <option value={row.status}>{row.status}</option>}
                  {STATUSES.map(status => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </td>
              <td className="nowrap">{row.lastTouch}</td>
              <td>{row.postingState ?? 'not checked'}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No opportunities with this status.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="pager">
        <button type="button" onClick={() => void load(filter, page - 1)} disabled={data.page === 0}>
          Previous
        </button>
        <span className="muted">
          {first}-{last} of {data.total}, page {data.page + 1} of {data.pages}
        </span>
        <button type="button" onClick={() => void load(filter, page + 1)} disabled={data.page >= data.pages - 1}>
          Next
        </button>
      </footer>
    </main>
  )
}
