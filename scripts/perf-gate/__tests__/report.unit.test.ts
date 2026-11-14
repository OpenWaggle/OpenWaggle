import { describe, expect, it } from 'vitest'
import { parsePerfGateReport } from '../report-data'
import { renderReport, REPORT_MARKER } from '../report-markdown'

const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)

function budgetRow(
  id: string,
  base: number,
  head: number,
  status: string,
  quanta: [number, number] = [1, 1],
) {
  return {
    id,
    title: 'ignored',
    unit: 'count',
    base,
    head,
    baseQuantum: quanta[0],
    headQuantum: quanta[1],
    status,
    fix: 'ignored',
  }
}

function timingRow(id: string, base: number, head: number, status: string, kind = 'timing') {
  return {
    id,
    kind,
    base,
    head,
    delta: head - base,
    relative: (head - base) / base,
    limit: 60,
    status,
  }
}

const REPORT = {
  baseSha: BASE,
  headSha: HEAD,
  pullRequest: 451,
  timingsSkipped: null,
  timingsUnavailable: null,
  labels: ['perf-budget-increase'],
  budgets: {
    rows: [
      budgetRow('main.startup.modules', 6256, 6256, 'same', [16, 16]),
      budgetRow('renderer.chat-ready.requests', 161, 162, 'raised'),
      budgetRow('package.runtime.files', 1648, 1656, 'quantum-raised', [8, 16]),
    ],
    accepted: true,
  },
  timings: {
    rows: [
      timingRow('cold.window-ready', 600, 604, 'same'),
      timingRow('cold.chat-ready', 1400, 1700, 'regressed'),
    ],
    loosened: [{ name: 'timing.relative', base: 0.1, head: 0.2 }],
  },
  pairs: 6,
  platform: 'linux-x64',
}

describe('the Performance Gate report', () => {
  it('puts changed rows first, folds the rest away and names every raised limit', () => {
    const parsed = parsePerfGateReport(REPORT)
    if (parsed === null) throw new Error('The report did not parse.')
    const markdown = renderReport(parsed)
    expect(markdown.startsWith(REPORT_MARKER)).toBe(true)
    expect(markdown).toContain('Base `aaaaaaaaa` (merge base) vs head `bbbbbbbbb`.')
    expect(markdown).toContain(
      'Only budgets can fail this check, and `perf-budget-increase` accepts a raise. Timings and memory are noisy, so they are reported only.',
    )
    expect(markdown).toContain('- Budgets: 2 increase(s), accepted by `perf-budget-increase`.')
    expect(markdown).toContain(
      '- 🔺 Timings: 1 regression(s): `cold.chat-ready`. Timings are reported only and never fail this check; reproduce with `bun run perf:ab`.',
    )
    expect(markdown.match(/`perf-[a-z-]+`/gu)).toEqual([
      '`perf-budget-increase`',
      '`perf-budget-increase`',
    ])
    expect(markdown).toContain(
      '- Limits raised: budget `package.runtime.files` quantum 8 → 16; timing threshold `timing.relative` 0.1 → 0.2.',
    )
    const raised = markdown.indexOf('`renderer.chat-ready.requests`')
    const unchanged = markdown.indexOf('`main.startup.modules`')
    expect(raised).toBeGreaterThan(0)
    expect(unchanged).toBeGreaterThan(markdown.indexOf('1 unchanged'))
    expect(markdown).toContain(
      '| `cold.chat-ready` | 1400 ms | 1700 ms | +300 ms (+21.4%) | 60 ms | 🔺 slower or heavier |',
    )
    expect(markdown.indexOf('`cold.chat-ready`')).toBeLessThan(
      markdown.indexOf('`cold.window-ready`'),
    )
  })

  it('asks for the budget label on an unaccepted increase, and says the check fails on it', () => {
    const parsed = parsePerfGateReport({
      ...REPORT,
      budgets: { ...REPORT.budgets, accepted: false },
      timings: { rows: [timingRow('cold.window-ready', 600, 604, 'same')], loosened: [] },
    })

    expect(parsed?.budgets?.passed).toBe(false)
    expect(parsed && renderReport(parsed)).toContain(
      '- 🔺 Budgets: 2 increase(s) fail this check. Fix them, or a maintainer adds `perf-budget-increase` and re-runs the check.',
    )
  })

  it('highlights a metric the head stopped measuring, without failing on it', () => {
    const parsed = parsePerfGateReport({
      ...REPORT,
      timings: {
        rows: [{ ...timingRow('cold.chat-ready', 1400, 0, 'missing'), head: null, delta: null }],
        loosened: [],
      },
    })

    expect(parsed?.timings).not.toHaveProperty('passed')
    expect(parsed?.timings).toMatchObject({ regressions: [{ status: 'missing' }] })
    expect(parsed && renderReport(parsed)).toContain('🔺 not measured on the head')
  })

  it('says plainly why timings cannot be judged, and highlights a readiness neither side measured', () => {
    const parsed = parsePerfGateReport({
      ...REPORT,
      timings: {
        rows: [
          {
            ...timingRow('warm.chat-ready', 0, 0, 'unavailable'),
            base: null,
            head: null,
            delta: null,
          },
        ],
        loosened: [],
        incomplete: [
          'The A/B results hold 0 base and head sample pairs (base 0, head 0); the comparison needs 10.',
          '**[click](https://example.com)**',
        ],
      },
    })

    expect(parsed?.timings).toMatchObject({
      incomplete: [
        'The A/B results hold 0 base and head sample pairs (base 0, head 0); the comparison needs 10.',
      ],
      regressions: [{ id: 'warm.chat-ready', status: 'unavailable' }],
    })
    const markdown = parsed ? renderReport(parsed) : ''
    expect(markdown).toContain(
      '- ⚠️ Timings cannot be judged: The A/B results hold 0 base and head sample pairs (base 0, head 0); the comparison needs 10. Timings are reported only and never fail this check; re-run the timing job to measure them.',
    )
    expect(markdown).toContain('🔺 not measured on either side')
  })

  it.each([
    'the timing job failed',
    'the timing job was cancelled or timed out',
    'the base or head build failed',
    'the A/B measurement failed',
    "the timing job's setup failed",
  ])('says timings are unavailable when %s', (reason) => {
    const parsed = parsePerfGateReport({ ...REPORT, timings: null, timingsUnavailable: reason })
    const markdown = parsed ? renderReport(parsed) : ''

    expect(markdown).toContain(
      `- ⚠️ Timings unavailable: ${reason}. Timings are reported only and never fail this check; re-run the timing job to measure them.`,
    )
    expect(markdown).toContain(`Unavailable: ${reason}.`)
    expect(parsePerfGateReport({ ...REPORT, timingsUnavailable: '<b>pwned</b>' })).toMatchObject({
      timingsUnavailable: null,
    })
  })

  it('says why timings were skipped', () => {
    const parsed = parsePerfGateReport({
      ...REPORT,
      timings: null,
      timingsSkipped: 'no shipped code changed',
    })
    expect(parsed && renderReport(parsed)).toContain('Skipped: no shipped code changed.')
  })

  it('drops whatever in an untrusted artifact is not a known shape', () => {
    const parsed = parsePerfGateReport({
      ...REPORT,
      labels: ['perf-budget-increase', '<img src=x>', '@everyone'],
      platform: '](https://example.com)',
      budgets: {
        rows: [
          budgetRow('ok.metric', 1, 2, 'raised'),
          budgetRow('[click](https://example.com)', 1, 2, 'raised'),
          budgetRow('ok.other', 1, 2, 'pwned'),
          { ...budgetRow('ok.third', 1, 2, 'raised'), head: '2 | <script>' },
        ],
        accepted: false,
      },
    })
    expect(parsed?.labels).toEqual(['perf-budget-increase'])
    expect(parsed?.platform).toBeNull()
    expect(parsed?.budgets?.rows.map((row) => [row.id, row.head])).toEqual([
      ['ok.metric', 2],
      ['ok.third', null],
    ])
    expect(parsePerfGateReport({ ...REPORT, headSha: 'not-a-sha' })).toBeNull()
  })
})
