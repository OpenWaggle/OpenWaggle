import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const workflowText = readFileSync('.github/workflows/windows-terminal-diagnostics.yml', 'utf8')
const workflow = parseDocument(workflowText)

describe('manual Windows terminal diagnostics', () => {
  it('requires an immutable commit and makes forced backend coverage explicit', () => {
    expect(workflow.errors).toEqual([])
    expect(workflow.getIn(['on', 'pull_request'])).toBeUndefined()
    expect(workflow.getIn(['on', 'push'])).toBeUndefined()
    expect(workflow.getIn(['on', 'workflow_dispatch', 'inputs', 'head_sha', 'required'])).toBe(true)
    expect(workflow.getIn(['on', 'workflow_dispatch', 'inputs', 'profile', 'default'])).toBe('all-backends')
    expect(workflow.getIn(['permissions', 'contents'])).toBe('read')
    expect(workflow.getIn(['jobs', 'native-pty', 'runs-on'])).toBe('windows-latest')
  })

  it('preserves failures and keeps user input out of PowerShell source', () => {
    expect(workflowText).toContain('exit $LASTEXITCODE')
    expect(workflowText).toContain('$env:DISPATCHED_SHA -cne $env:EXPECTED_SHA')
    expect(workflowText).toContain('scripts/native-load-probe.ts $env:NATIVE_RUNTIME')
    expect(workflowText).not.toContain('continue-on-error')
    expect(workflowText).not.toContain("'${{ inputs.")
  })
})
