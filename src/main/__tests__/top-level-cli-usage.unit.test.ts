import { USAGE_STATISTICS_DOCS_URL } from '@shared/constants/usage-statistics'
import { describe, expect, it } from 'vitest'
import { topLevelCliUsage } from '../top-level-cli-usage'

const MAX_HELP_LINE_LENGTH = 80

describe('top-level CLI usage', () => {
  it('names the usage statistics, how to turn them off, and where they are documented', () => {
    const usage = topLevelCliUsage('1.2.3')

    expect(usage).toContain('anonymous usage statistics')
    expect(usage).toContain("switch in the desktop app's Settings")
    expect(usage).toContain(USAGE_STATISTICS_DOCS_URL)
  })

  it('says DO_NOT_TRACK applies only to the processes it is set for', () => {
    const usage = topLevelCliUsage('1.2.3').replaceAll('\n', ' ')

    expect(usage).toContain('DO_NOT_TRACK=1 turns them off only for the processes started with it')
    expect(usage).toContain('including a Session Host that such a command starts')
    expect(usage).toContain(
      'A Session Host that is already running, or one the desktop app starts, keeps its own environment',
    )
  })

  it('keeps the statistics paragraph within a standard terminal width', () => {
    const lines = topLevelCliUsage('1.2.3').split('\n')
    const start = lines.findIndex((line) => line.includes('anonymous usage statistics'))
    const paragraph = lines.slice(start, lines.indexOf('', start))

    expect(paragraph.length).toBeGreaterThan(0)
    for (const line of paragraph) expect(line.length).toBeLessThanOrEqual(MAX_HELP_LINE_LENGTH)
  })
})
