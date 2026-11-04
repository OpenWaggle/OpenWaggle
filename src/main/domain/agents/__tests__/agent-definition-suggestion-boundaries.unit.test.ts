import { describe, expect, it } from 'vitest'
import { suggestAgentDefinition } from '../agent-definition-suggestion'

const REVIEWER = {
  name: 'reviewer',
  description:
    'Review a diff, a branch or a merge request against the project guidelines and its ticket with a fresh context. Use when the agent that wrote the code needs an independent review.',
}
const IMPLEMENTER = {
  name: 'implementer',
  description:
    'Implement a ticket on a fresh branch with tests, fix review findings and regressions, and open a merge request against the project guidelines.',
}

/** Where the matcher stops reading a role: quotes, other speakers, its limits. */
describe('suggestAgentDefinition boundaries', () => {
  it('takes only the first role statement, and none that is the speaker’s', () => {
    expect(
      suggestAgentDefinition(
        {
          objective:
            'You are the implementer. As the reviewer, I found regressions and missing tests in the diff; fix the correctness findings on the branch and open a merge request.',
        },
        [REVIEWER, IMPLEMENTER],
      ),
    ).toEqual(IMPLEMENTER)
    for (const objective of [
      'As reviewer, I flagged correctness regressions and missing tests. Fix them in the diff of the branch against the ticket.',
      'Acting as the reviewer, I found three regressions in the diff of the branch against the ticket and the guidelines.',
      'As the reviewers in round 2 flagged, fix the correctness bugs, regressions and missing tests in the diff of the branch.',
      'As the reviewer of PR #405 found, the diff has correctness bugs, regressions and missing tests against the ticket. Fix them.',
      'As the reviewer and I discussed, fix the correctness bugs and regressions in the diff of the branch against the ticket.',
      'As reviewer: I found three regressions in the diff of the branch against the ticket and the guidelines.',
      'As the reviewer — I found three regressions in the diff of the branch against the ticket and the guidelines.',
      'As reviewer, Worker 2 flagged three regressions in the diff of the branch against the ticket and the guidelines.',
    ]) {
      expect(suggestAgentDefinition({ objective }, [REVIEWER])).toBeUndefined()
    }
  })

  it('never reads a role from a quoted objective for another Worker', () => {
    for (const objective of [
      'Spawn three Workers, each with this objective: "Review PR #405 against main. You are an independent reviewer with a fresh context. Check the diff against the ticket and the project guidelines."',
      'Give each Worker this objective: “Check PR 405. You are an independent reviewer with a fresh context, against the ticket and the project guidelines.”',
      'Coordinate the review. Each Worker gets:\n```\nReview PR 405.\nYou are an independent reviewer with a fresh context. Check the diff against the ticket and the project guidelines.\n```',
      'Coordinate the review. Each Worker gets:\n> Review PR 405. You are an independent reviewer with a fresh context. Check the diff against the ticket and the project guidelines.',
      'Spawn two Workers and merge their findings. Give each this objective:\n"You are an independent reviewer with a fresh context. Review the diff of the branch against the ticket and the project guidelines."',
      'Spawn two Workers and merge their findings. Give each this objective:\n> You are an independent reviewer with a fresh context. Review the diff of the branch against the ticket and the project guidelines.',
    ]) {
      expect(suggestAgentDefinition({ objective }, [REVIEWER])).toBeUndefined()
    }
    expect(
      suggestAgentDefinition(
        {
          objective:
            '1) You are an independent reviewer with a fresh context. Review the diff of the branch against the ticket and the project guidelines.',
        },
        [REVIEWER],
      ),
    ).toEqual(REVIEWER)
  })

  it('holds to its limits: the opening, the phrase length, a plural head, a contraction', () => {
    const tail =
      ' Review the diff of the branch against the ticket and the project guidelines with a fresh context.'
    const read = (objective: string) => suggestAgentDefinition({ objective }, [REVIEWER])

    expect(
      read(`${'Context for the change. '.repeat(11)}You are the reviewer.${tail}`),
    ).toBeUndefined()
    // Multi-character sentence breaks count in full toward the opening.
    expect(
      read(`${'Context for the change.\n\n'.repeat(10)}You are the reviewer.${tail}`),
    ).toBeUndefined()
    expect(read(`You are the independent senior lead staff code reviewer.${tail}`)).toBeUndefined()
    expect(read(`You are the reviewers for this change.${tail}`)).toEqual(REVIEWER)
    expect(read(`You are the reviewer it's assigned to.${tail}`)).toEqual(REVIEWER)
  })

  it('compares no description too short to tell a role by', () => {
    expect(
      suggestAgentDefinition({ objective: 'You are the reviewer. Look at the diffs carefully.' }, [
        { name: 'reviewer', description: 'Reviews diffs carefully.' },
      ]),
    ).toBeUndefined()
  })
})
