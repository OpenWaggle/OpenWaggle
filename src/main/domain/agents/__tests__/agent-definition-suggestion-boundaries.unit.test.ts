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
    for (const objective of [
      'You are the implementer. As the reviewer, I found regressions and missing tests in the diff; fix the correctness findings.',
      'As reviewer, I flagged correctness regressions and missing tests. Fix them in the diff of the branch against the ticket.',
    ]) {
      expect(suggestAgentDefinition({ objective }, [REVIEWER])).toBeUndefined()
      expect(suggestAgentDefinition({ objective }, [REVIEWER, IMPLEMENTER])).not.toEqual(REVIEWER)
    }
  })

  it('never reads a role from a quoted objective for another Worker', () => {
    for (const objective of [
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
    expect(read(`You are the independent senior lead staff code reviewer.${tail}`)).toBeUndefined()
    expect(read(`As reviewers, check the change.${tail}`)).toEqual(REVIEWER)
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
