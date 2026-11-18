import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

const WORKFLOW = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/windows-native-helpers.yml'),
  'utf8',
)

function stepRuns(workflow: string) {
  const steps = parseDocument(workflow).getIn(['jobs', 'windows-helpers', 'steps'])
  if (!isSeq(steps)) return []
  return steps.items.flatMap((step) => {
    if (!isMap(step)) return []
    const run = step.get('run', true)
    return isScalar(run) && typeof run.value === 'string' ? [run.value] : []
  })
}

describe('Windows native helpers workflow', () => {
  // Under `bun --bun vitest`, Bun reported the Electron CLI's 0xFFFFFFFF exit as 255, so the
  // session-host-shutdown integration test failed on every push (it expects 4294967295).
  it('runs every Vitest step on Node.js, the runtime the helpers ship on', () => {
    const vitestRuns = stepRuns(WORKFLOW).filter((run) => run.includes('vitest'))
    expect(vitestRuns).toHaveLength(2)
    for (const run of vitestRuns) {
      expect(run).toMatch(/^node node_modules\/vitest\/vitest\.mjs run /u)
    }
  })
})
