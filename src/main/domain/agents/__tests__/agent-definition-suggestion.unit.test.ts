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
    const senior = { ...REVIEWER, name: 'senior-reviewer' }
    const code = { ...REVIEWER, name: 'code-reviewer' }
    expect(
      suggestAgentDefinition(
        {
          objective:
            'You are a senior code reviewer who did not write the code: review the diff of this branch against the guidelines and the ticket with a fresh context.',
        },
        [senior, code],
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

  it('ignores a role a short objective hands off to', () => {
    for (const objective of [
      'Fix the failing tests in the security module, then hand off to the reviewer. Make sure the code is correct with no regressions against the project guidelines and the ticket.',
      'Implement the change described below with tests; a reviewer Worker will review the diff of the branch for correctness, regressions and the project guidelines.',
    ]) {
      expect(suggestAgentDefinition({ objective }, [REVIEWER])).toBeUndefined()
    }
  })

  it('reads the role only where the objective states its own, with the name as its head', () => {
    for (const input of [
      {
        objective:
          'Act as the implementer for the ticket, then hand off the diff of the branch to the reviewer against the project guidelines.',
      },
      {
        objective:
          'You are the implementer, not the reviewer: implement the ticket and keep the diff of the branch within the project guidelines.',
      },
      {
        objective:
          'Fix the bug you are seeing and tell the reviewer what changed in the diff of the branch against the ticket.',
      },
      {
        objective:
          'Do not act as a reviewer; implement the ticket and keep the diff of the branch within the project guidelines.',
      },
      {
        objective:
          "Address the reviewer's findings on branch feat/x: fix the regression in the diff against the ticket and the guidelines.",
      },
      {
        title: 'Fix reviewer findings round 2',
        objective:
          'Reviewer findings to fix on the branch. Fix the regression in the diff against the ticket and the project guidelines.',
      },
      {
        objective:
          'Implement the ticket on the branch and ask the reviewer to check the diff against the project guidelines with a fresh context',
      },
      {
        objective:
          "You are the reviewer's assistant: collect the diff of the branch against the ticket and the project guidelines.",
      },
    ]) {
      expect(suggestAgentDefinition(input, [REVIEWER])).toBeUndefined()
    }
  })

  it('reads "As the …" and a role after a leading bullet', () => {
    for (const objective of [
      'As the independent reviewer of this branch, review the diff against the ticket and the project guidelines with a fresh context.',
      '- You are a reviewer with a fresh context. Review the diff of the branch against the ticket and the project guidelines.',
    ]) {
      expect(suggestAgentDefinition({ objective }, [REVIEWER])).toEqual(REVIEWER)
    }
  })

  it('keeps every word of a name, short ones included', () => {
    const ux = { ...REVIEWER, name: 'ux-reviewer' }
    const qa = { ...REVIEWER, name: 'qa' }
    const generic =
      'You are a code reviewer with a fresh context. Review the diff of the branch against the ticket and the project guidelines.'
    const specific =
      'You are the UX reviewer with a fresh context. Review the diff of the branch against the ticket and the project guidelines.'

    expect(suggestAgentDefinition({ objective: generic }, [ux])).toBeUndefined()
    expect(suggestAgentDefinition({ objective: specific }, [REVIEWER, ux])).toEqual(ux)
    expect(
      suggestAgentDefinition(
        {
          objective:
            'You are the QA for this change. Review the diff of the branch against the ticket and the project guidelines with a fresh context.',
        },
        [qa],
      ),
    ).toEqual(qa)
  })

  it('reads no role when the opener leads into a verb or a possessive', () => {
    for (const objective of [
      'You are helping the reviewer: review the diff of the branch against the ticket and the project guidelines.',
      'You are replacing the reviewer, so review the diff of the branch against the ticket and the project guidelines.',
      'As per the reviewer, fix the regression in the diff of the branch against the ticket and the project guidelines.',
      'You are no longer the reviewer: review the diff of the branch against the ticket and the project guidelines.',
      "You are the reviewers' pair: review the diff of the branch against the ticket and the project guidelines.",
    ]) {
      expect(suggestAgentDefinition({ objective }, [REVIEWER])).toBeUndefined()
    }
  })

  it('reads the role past an adverb, a contraction after it, and any spacing', () => {
    for (const objective of [
      'You are now the reviewer. Review the diff of the branch against the ticket and the project guidelines with a fresh context.',
      "You are the reviewer who's checking this change. Review the diff of the branch against the ticket and the project guidelines.",
      'You  are the reviewer. Review the diff of the branch against the ticket and the project guidelines with a fresh context.',
      'You\u00a0are the reviewer. Review the diff of the branch against the ticket and the project guidelines with a fresh context.',
    ]) {
      expect(suggestAgentDefinition({ objective }, [REVIEWER])).toEqual(REVIEWER)
    }
  })
})
