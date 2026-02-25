import { describe, expect, it } from 'vitest'
import { buildPlannerPrompt, hasWebIntent, parsePlannerDecision } from './planner'

describe('hasWebIntent', () => {
  it('detects explicit URL', () => {
    expect(hasWebIntent('check https://tanstack.com/ai')).toBe(true)
  })

  it('detects web intent keywords', () => {
    expect(hasWebIntent('go to tanstack ai docs')).toBe(true)
    expect(hasWebIntent('visit the official site')).toBe(true)
    expect(hasWebIntent('look up the API reference')).toBe(true)
    expect(hasWebIntent('what does the website say')).toBe(true)
  })

  it('returns false for non-web prompts', () => {
    expect(hasWebIntent('what is TypeScript?')).toBe(false)
    expect(hasWebIntent('explain how the agent loop works')).toBe(false)
  })

  it('does not false-positive on related words', () => {
    expect(hasWebIntent('write a documentary-style summary')).toBe(false)
  })
})

describe('buildPlannerPrompt', () => {
  it('forces decomposition when web intent is enabled', () => {
    const prompt = buildPlannerPrompt('## Project Context', 'find docs', true)
    expect(prompt).toContain('The user explicitly needs web-derived information')
    expect(prompt).toContain('MUST decompose into tasks')
    expect(prompt).not.toContain('{"direct":true')
  })

  it('keeps direct-response branch for non-web prompts', () => {
    const prompt = buildPlannerPrompt('## Project Context', 'what is closure', false)
    expect(prompt).toContain('Choose between direct response and task decomposition')
    expect(prompt).toContain('{"direct":true,"response":"your answer"}')
  })
})

describe('parsePlannerDecision', () => {
  it('parses direct response payload', () => {
    const decision = parsePlannerDecision({ direct: true, response: 'Quick answer.' })
    expect(decision).toEqual({ kind: 'direct', response: 'Quick answer.' })
  })

  it('parses task payload with ack text', () => {
    const decision = parsePlannerDecision({
      ackText: 'Working on it',
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do it' }],
    })
    expect(decision.kind).toBe('tasks')
    if (decision.kind === 'tasks') {
      expect(decision.ackText).toBe('Working on it')
      expect(decision.tasks).toHaveLength(1)
    }
  })

  it('falls back to empty task plan on invalid payload', () => {
    const decision = parsePlannerDecision('not-json')
    expect(decision).toEqual({ kind: 'tasks', ackText: null, tasks: [] })
  })
})
