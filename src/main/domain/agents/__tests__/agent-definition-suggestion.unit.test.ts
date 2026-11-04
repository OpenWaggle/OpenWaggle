import { describe, expect, it } from 'vitest'
import { suggestAgentDefinition } from '../agent-definition-suggestion'

const REVIEWER = {
  name: 'reviewer',
  description:
    'Review a diff, a branch or a merge request against the project guidelines and its ticket with a fresh context. Use when the agent that wrote the code needs an independent review.',
}
const PLANNER = {
  name: 'planner',
  description:
    'Break a feature request into an ordered implementation plan with milestones, risks and open questions. Use before any code is written.',
}

describe('suggestAgentDefinition', () => {
  it('names the definition whose role a hand-written objective restates', () => {
    expect(
      suggestAgentDefinition(
        {
          title: 'Independent code review round 2: MR !302',
          objective:
            'You are an independent code reviewer with a fresh context; you did not author this change. Review the full diff of the branch against main and the ticket scope. Report findings by severity.',
        },
        [PLANNER, REVIEWER],
      ),
    ).toEqual(REVIEWER)
  })

  it('suggests nothing when a long objective only mentions the role in passing', () => {
    expect(
      suggestAgentDefinition(
        {
          title: 'Drop the compatibility views',
          objective: `You own the ticket end to end. Implement it on a fresh branch from main with tests, then open a merge request. ${'Keep the diff small and follow the project guidelines. '.repeat(6)}Afterwards spawn an independent reviewer with a fresh context to review the diff of the branch against the ticket, and fix what it finds.`,
        },
        [REVIEWER],
      ),
    ).toBeUndefined()
  })

  it('suggests nothing when the name appears but little of the description does', () => {
    expect(
      suggestAgentDefinition({ objective: 'Review the docs wording for typos.' }, [REVIEWER]),
    ).toBeUndefined()
  })

  it('does not count the name toward the description share', () => {
    const reviewer = {
      name: 'reviewer',
      description:
        'Independent code reviewer for pull requests and diffs: correctness, regressions, security, and missing tests.',
    }
    expect(
      suggestAgentDefinition(
        { objective: 'Fix the flaky test in the reviewer assignment code path.' },
        [reviewer],
      ),
    ).toBeUndefined()
  })

  it('suggests nothing when two definitions fit about equally well', () => {
    const twin = { ...REVIEWER, name: 'review' }
    expect(
      suggestAgentDefinition(
        {
          objective:
            'Independent review: review the diff of this branch against the guidelines and the ticket with a fresh context, as a reviewer who did not write the code.',
        },
        [REVIEWER, twin],
      ),
    ).toBeUndefined()
  })

  it('ignores definitions whose description is too short to compare', () => {
    expect(
      suggestAgentDefinition({ objective: 'You are the reviewer. Review the diff.' }, [
        { name: 'reviewer', description: 'Reviews.' },
      ]),
    ).toBeUndefined()
  })

  it('matches multi-word names only when every word appears where the role is stated', () => {
    const security = {
      name: 'security-reviewer',
      description:
        'Audit a change for injection, secrets, authorization gaps and unsafe dependencies before it merges.',
    }
    expect(
      suggestAgentDefinition(
        {
          objective:
            'Act as the security reviewer for this change: audit it for injection, leaked secrets, authorization gaps and unsafe dependencies.',
        },
        [security],
      ),
    ).toEqual(security)
    expect(
      suggestAgentDefinition(
        {
          objective:
            'Act as a reviewer for this change: audit it for injection, leaked secrets, authorization gaps and unsafe dependencies.',
        },
        [security],
      ),
    ).toBeUndefined()
  })

  it('prefers the definition whose whole name the objective states over a generic one', () => {
    const security = {
      name: 'security-reviewer',
      description:
        'Audit a change for injection, secrets, authorization gaps and unsafe dependencies before it merges.',
    }
    expect(
      suggestAgentDefinition(
        {
          title: 'Security review: MR !302',
          objective:
            'You are an independent security reviewer with a fresh context; you did not write this change. Review the diff of the branch against the ticket and the project guidelines, and audit it for injection and secrets.',
        },
        [REVIEWER, security],
      ),
    ).toEqual(security)
  })

  it('does not take the plain noun or verb for an -er name', () => {
    const tester = {
      name: 'tester',
      description:
        'Write and run tests for a change, cover edge cases and regressions, and report what fails.',
    }
    expect(
      suggestAgentDefinition(
        {
          title: 'Implement upload size cap',
          objective:
            'Implement the upload size cap on a fresh branch with tests covering the edge cases, run the test suite, and report what changed.',
        },
        [tester, PLANNER],
      ),
    ).toBeUndefined()
    expect(
      suggestAgentDefinition(
        {
          objective:
            'You are the tester for this change: write and run tests that cover its edge cases and regressions, and report what fails.',
        },
        [tester],
      ),
    ).toEqual(tester)
  })
})
