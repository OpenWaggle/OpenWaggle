import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

const workflowText = readFileSync('.github/workflows/windows-terminal-diagnostics.yml', 'utf8')
const workflow = parseDocument(workflowText)

describe('manual Windows terminal diagnostics', () => {
  it('requires an immutable commit and runs only on demand on Windows', () => {
    expect(workflow.errors).toEqual([])
    expect(workflow.getIn(['on', 'pull_request'])).toBeUndefined()
    expect(workflow.getIn(['on', 'push'])).toBeUndefined()
    expect(workflow.getIn(['on', 'workflow_dispatch', 'inputs', 'head_sha', 'required'])).toBe(true)
    expect(workflow.getIn(['permissions', 'contents'])).toBe('read')
    expect(workflow.getIn(['jobs', 'terminal-backend', 'runs-on'])).toBe('windows-latest')
  })

  it('runs the terminal backend tests, preserves failures and keeps input out of PowerShell', () => {
    expect(workflowText).toContain('vitest.integration.config.ts src/main/adapters/terminal')
    expect(workflowText).toContain('exit $LASTEXITCODE')
    expect(workflowText).toContain('$env:DISPATCHED_SHA -cne $env:EXPECTED_SHA')
    expect(workflowText).not.toContain('continue-on-error')
    expect(workflowText).not.toContain("'${{ inputs.")
  })
})
