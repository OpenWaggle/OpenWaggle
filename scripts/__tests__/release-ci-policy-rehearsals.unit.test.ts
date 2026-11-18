import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateReleaseCiPolicy } from '../release-ci-policy'

const compliantWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8')

describe('release CI policy for the path-scoped rehearsals', () => {
  it.each([
    ['package-release-rehearsal-package', 'Package Consumer Rehearsal (Node 22.19.0)'],
    ['package-release-rehearsal-website', 'Website & Docs Rehearsal (Node 24.14.0)'],
  ])('runs %s on pull requests that change its paths', (jobKey, jobName) => {
    const jobStart = compliantWorkflow.indexOf(`  ${jobKey}:\n`)
    const pullRequestTrigger =
      "github.event_name == 'pull_request' || github.event_name == 'merge_group'"
    const triggerIndex = compliantWorkflow.indexOf(pullRequestTrigger, jobStart)
    expect(jobStart).toBeGreaterThan(-1)
    expect(triggerIndex).toBeGreaterThan(jobStart)
    const withoutPullRequests =
      compliantWorkflow.slice(0, triggerIndex) +
      "github.event_name == 'merge_group'" +
      compliantWorkflow.slice(triggerIndex + pullRequestTrigger.length)
    expect(validateReleaseCiPolicy(withoutPullRequests)).toContain(
      `CI conditional job ${jobName} must keep its exact job-level condition.`,
    )
  })
})
