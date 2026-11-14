import { describe, expect, it } from 'vitest'
import { type GhApi, maintainerLabels } from '../gate'

const REPO = 'owner/name'
const PR = '7'
const RUN = '99'
const RUN_CREATED = '2026-11-14T10:00:00Z'
const BEFORE = '2026-11-14T09:59:59Z'
const AFTER = '2026-11-14T10:05:00Z'

interface Labeled {
  readonly label: string
  readonly actor: string
  readonly at: string
}

/** A `gh api` stand-in answering the four calls maintainerLabels makes. */
function stubGh(input: {
  readonly present: readonly string[]
  readonly labeled: readonly Labeled[]
  readonly roles?: Readonly<Record<string, string>>
}) {
  const calls: string[] = []
  const gh: GhApi = (args) => {
    const endpoint = args.find((arg) => arg.startsWith('repos/')) ?? ''
    calls.push(endpoint)
    if (endpoint === `repos/${REPO}/issues/${PR}/labels`) return `${input.present.join(',')}\n`
    if (endpoint === `repos/${REPO}/actions/runs/${RUN}/attempts/1`) return `${RUN_CREATED}\n`
    if (endpoint === `repos/${REPO}/issues/${PR}/events`) {
      return input.labeled.map((event) => `${event.label}\t${event.actor}\t${event.at}\n`).join('')
    }
    const actor = /^repos\/owner\/name\/collaborators\/([^/]+)\/permission$/u.exec(endpoint)?.[1]
    if (actor !== undefined) return `${input.roles?.[actor] ?? 'write'}\n`
    throw new Error(`unexpected gh api call: ${args.join(' ')}`)
  }
  return { gh, calls }
}

describe('Performance Gate maintainer labels', () => {
  it('counts a label a maintainer added after the run was created', () => {
    const { gh } = stubGh({
      present: ['perf-regression-accepted'],
      labeled: [{ label: 'perf-regression-accepted', actor: 'lead', at: AFTER }],
      roles: { lead: 'maintain' },
    })

    expect(maintainerLabels(REPO, PR, RUN, gh)).toEqual(['perf-regression-accepted'])
  })

  it('ignores a label added before this run, so a new push must be labelled again', () => {
    const { gh } = stubGh({
      present: ['perf-regression-accepted', 'perf-budget-increase'],
      labeled: [
        { label: 'perf-budget-increase', actor: 'lead', at: BEFORE },
        { label: 'perf-regression-accepted', actor: 'lead', at: RUN_CREATED },
      ],
      roles: { lead: 'admin' },
    })

    expect(maintainerLabels(REPO, PR, RUN, gh)).toEqual([])
  })

  it('judges the last time a label was added', () => {
    const { gh } = stubGh({
      present: ['perf-budget-increase'],
      labeled: [
        { label: 'perf-budget-increase', actor: 'lead', at: AFTER },
        { label: 'perf-budget-increase', actor: 'contributor', at: '2026-11-14T10:06:00Z' },
      ],
      roles: { lead: 'admin', contributor: 'write' },
    })

    expect(maintainerLabels(REPO, PR, RUN, gh)).toEqual([])
  })

  it('ignores a label a non-maintainer added, and one no longer on the pull request', () => {
    const { gh } = stubGh({
      present: ['perf-budget-increase'],
      labeled: [
        { label: 'perf-budget-increase', actor: 'contributor', at: AFTER },
        { label: 'perf-regression-accepted', actor: 'lead', at: AFTER },
      ],
      roles: { lead: 'admin', contributor: 'write' },
    })

    expect(maintainerLabels(REPO, PR, RUN, gh)).toEqual([])
  })

  it('reads nothing more when no gate label is on the pull request', () => {
    const { gh, calls } = stubGh({ present: ['documentation'], labeled: [] })

    expect(maintainerLabels(REPO, PR, RUN, gh)).toEqual([])
    expect(calls).toEqual([`repos/${REPO}/issues/${PR}/labels`])
  })
})
