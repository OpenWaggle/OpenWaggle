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
      `You are the reviewer of your teammate's change.${TASK}`,
      `**You are the reviewer.**${TASK}`,
      `_You are the reviewer_ for this change.${TASK}`,
      `Branch feat/x against main\nYou are the reviewer.${TASK}`,
      `Role:\nYou are the reviewer.${TASK}`,
      `# Role: You are the reviewer.${TASK}`,
      `## Your task:\nYou are the reviewer.${TASK}`,
      `**Role:**\nYou are the reviewer.${TASK}`,
      `**Role**:\nYou are the reviewer.${TASK}`,
      `You are the reviewer, review and report.${TASK}`,
      `You are the reviewer, and fix what you find.${TASK}`,
      `Objective: You are the reviewer.${TASK}`,
      `**Task:** You are the reviewer.${TASK}`,
      `Your task: You are the reviewer.${TASK}`,
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
      `For this ticket, you are the implementer. Act as the reviewer of your own diff.${TASK}`,
      `For this ticket, you are now the implementer. Act as the reviewer of your own diff.${TASK}`,
      `Implement ABC-12 on a fresh branch with tests. Act as the reviewer of your own diff.${TASK}`,
      `Role: implementer for ticket ABC-12. Implement it with tests. Act as the reviewer.${TASK}`,
      `Your role is the implementer for ABC-12. Act as the reviewer.${TASK}`,
      `**Task:** Your role is the implementer for ABC-12. Act as the reviewer of the final diff.${TASK}`,
      `For ABC-12, **you are the implementer**. Act as the reviewer of the final diff.${TASK}`,
      `(For this ticket you are the implementer.) Act as the reviewer, and check the diff.${TASK}`,
      `Round 2 (you are the implementer). Act as the reviewer, check the diff.${TASK}`,
      `1) Role: implementer for ABC-12.\n2) Implement it with tests.\n3) Act as the reviewer.${TASK}`,
      `Implement ABC-12 with tests. You are also the reviewer: check the final diff.${TASK}`,
      `Fix-up round 2: you are the implementer. Act as the reviewer of your own diff.${TASK}`,
      `Ticket ABC-12: You are the implementer. You are also the reviewer of your own diff.${TASK}`,
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
      `Coordinate three Workers and merge their findings.\n**Worker objective:**\n${inner}`,
      `Spawn three reviewers, each with this objective: Review PR 405 against main. ${inner}`,
      `Coordinate the review. Each Worker gets: Review PR 405. ${inner}`,
      `Spawn three Workers, each with this task: Review one area of PR 405. ${inner}`,
      `Spawn three Workers, each with the following: Review one area of PR 405. ${inner}`,
      `Coordinate the review. Each Worker receives: Review PR 405. ${inner}`,
      `Spawn three Workers. Give each 'Merge the reviewers' PR comments. ${inner}' as the objective.`,
      `Spawn three Workers. Give each 'Check it's green. ${inner}' as the objective.`,
      `Coordinate three Workers.\n**For each Worker:**\n${inner}`,
      `Coordinate one Worker per failing 'unit tests' job, each with this objective:\nCheck the 'lint' output. ${inner}`,
      `Spawn three Workers. Each gets: 'Merge the reviewers' PR comments. ${inner}'`,
      `Spawn two Workers. Give each\n\t${inner}`,
      `Spawn three Workers. Each gets: 'Ignore the other Workers' findings. ${inner}'`,
    ]) {
      expect(roleStatement(objective)).toEqual([])
    }
  })

  it('reads no compound role, joined by a sign, a joining word or listed after a comma', () => {
    for (const objective of [
      `You are the reviewer & fixer for PR #405.${TASK}`,
      `You are the reviewer + fixer for PR #405.${TASK}`,
      `You are the planner, implementer and tester for this feature request.${TASK}`,
      `You are the reviewer, and the fixer for PR #405.${TASK}`,
      `You are a reviewer, or an implementer, whichever the diff needs.${TASK}`,
      `You are the reviewer — and the fixer — for PR #405.${TASK}`,
      `You are the reviewer as well as the fixer for PR #405.${TASK}`,
      `Act as reviewer then fixer: review PR 405 and fix every finding.${TASK}`,
      `You are the reviewer, but also the fixer for PR #405.${TASK}`,
    ]) {
      expect(roleStatement(objective)).toEqual([])
    }
  })

  it('reads no role where a quote after an s could close a span or continue it', () => {
    expect(
      roleStatement(
        `Fix the failing 'Unit Tests' check on branch feat/x. You are the implementer. Rerun 'pnpm verify' locally. Act as the reviewer.`,
      ),
    ).toEqual([])
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
