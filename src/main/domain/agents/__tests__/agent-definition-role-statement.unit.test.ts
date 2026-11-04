import { describe, expect, it } from 'vitest'
import { roleStatement } from '../agent-definition-role-statement'

const TASK = ' Review the diff of the branch against the ticket and the project guidelines.'

/** The rules' main cases, read directly: each case fails when the rule it names is removed. */
describe('roleStatement', () => {
  it('reads every opener, any case, after a list marker or emphasis, on its own line', () => {
    for (const objective of [
      `You're the reviewer with a fresh context;${TASK}`,
      `Work as the reviewer of this branch.${TASK}`,
      `Serve as reviewer.${TASK}`,
      `YOU ARE THE REVIEWER.${TASK}`,
      `**You are the reviewer.**${TASK}`,
      `_You are the reviewer_ for this change.${TASK}`,
      `Branch feat/x against main\nYou are the reviewer.${TASK}`,
      `Role:\nYou are the reviewer.${TASK}`,
      `## Your task:\nYou are the reviewer.${TASK}`,
    ]) {
      expect(roleStatement(objective)).toEqual(['reviewer'])
    }
  })

  it('reads an opener only at the start of a clause', () => {
    expect(roleStatement(`Once the fix lands you are the reviewer.${TASK}`)).toEqual([])
    expect(roleStatement(`And now you are the reviewer.${TASK}`)).toEqual([])
  })

  it('keeps a phrase of up to five words and drops a longer one', () => {
    expect(roleStatement(`You are the independent senior lead code reviewer.${TASK}`)).toEqual([
      'independent',
      'senior',
      'lead',
      'code',
      'reviewer',
    ])
    expect(
      roleStatement(`You are the independent senior lead staff code reviewer.${TASK}`),
    ).toEqual([])
  })

  it('takes the first statement, even one that names no role', () => {
    for (const objective of [
      `You are not the implementer. You are the reviewer.${TASK}`,
      `Act as the reviewer, I found three regressions. You are the reviewer.${TASK}`,
      `You are "the implementer". You are the reviewer.${TASK}`,
    ]) {
      expect(roleStatement(objective)).toEqual([])
    }
  })

  it('reads a speaker after an "as" opener in any case, never after "You are"', () => {
    for (const objective of [
      `Act As the reviewer, I found three regressions.${TASK}`,
      `ACT AS THE REVIEWER, I FOUND THREE REGRESSIONS.${TASK}`,
    ]) {
      expect(roleStatement(objective)).toEqual([])
    }
    expect(
      roleStatement(`You are a reviewer for PR #323 (branch feat/x, HEAD 2017575).${TASK}`),
    ).toEqual(['reviewer'])
  })

  it('reads no role inside any quoted or introduced text, closed or not', () => {
    const inner = `You are an independent reviewer with a fresh context.${TASK}`
    for (const objective of [
      `Spawn two Workers. Give each "Check PR 405. ${inner}`,
      `Spawn two Workers. Give each “Check PR 405. ${inner}`,
      `Spawn two Workers. Give each\n\`\`\`\nCheck PR 405.\n${inner}`,
      `Spawn two Workers. Give each\n~~~\nCheck PR 405.\n${inner}\n~~~`,
      `Spawn two Workers. Give each\n    Check PR 405.\n    ${inner}`,
      `Spawn two Workers. Give each \`Check PR 405. ${inner.slice(0, 40)}\` as the objective.`,
      `Spawn two Workers. Give each 'Check PR 405. ${inner}' as the objective.`,
      `Spawn two Workers, one per area, each with this objective:\n${inner}`,
      `Spawn three reviewers and merge their findings.\nEach Worker gets:\n${inner}`,
      `Coordinate the review of PR 405.\nWorker objective:\n${inner}`,
      `Spawn two Workers. Give each\n\t${inner}`,
      `Spawn three Workers. Each gets: 'Ignore the other Workers' findings. ${inner}'`,
    ]) {
      expect(roleStatement(objective)).toEqual([])
    }
  })

  it('closes a quoted word ending in s at its own quote', () => {
    expect(
      roleStatement(
        `Rerun the 'tests' job first. You are the reviewer. Then check the 'lint' output.`,
      ),
    ).toEqual(['reviewer'])
    expect(
      roleStatement(
        `Summarize the 'reviews' tab changes. You are the implementer. Rerun the 'lint' job. Act as the reviewer.`,
      ),
    ).toEqual(['implementer'])
  })

  it('takes an apostrophe for no quote', () => {
    expect(roleStatement(`Use the '90s rules. You are the reviewer. It's fine.`)).toEqual([
      'reviewer',
    ])
    expect(
      roleStatement(`You're the reviewer with a fresh context; check the 'project' rules.`),
    ).toEqual(['reviewer'])
  })

  it('drops a phrase that a quoted word or a possessive interrupts', () => {
    for (const objective of [
      `You are "not" the reviewer.${TASK}`,
      `You are the reviewer "assistant".${TASK}`,
      `You are the reviewer ‘assistant’.${TASK}`,
      `You are the code reviewer's assistant.${TASK}`,
    ]) {
      expect(roleStatement(objective)).toEqual([])
    }
  })

  it('reads only the start of a long objective, quickly', () => {
    const started = Date.now()
    expect(roleStatement(`${"'a ".repeat(30_000)}You are the reviewer.`)).toEqual([])
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
