import { describe, expect, test } from 'vitest'

import { extractJson } from '../json'
import { MAX_PLAN_TASKS, OpenHivePlanValidationError, parseOpenHivePlan } from '../planner'

describe('extractJson', () => {
  test('parses plain JSON', () => {
    expect(extractJson('{"tasks": []}')).toEqual({ tasks: [] })
  })

  test('strips markdown code fences', () => {
    const input = '```json\n{"tasks": [{"id": "a"}]}\n```'
    expect(extractJson(input)).toEqual({ tasks: [{ id: 'a' }] })
  })

  test('strips generic code fences', () => {
    const input = '```\n{"key": "value"}\n```'
    expect(extractJson(input)).toEqual({ key: 'value' })
  })

  test('extracts JSON from preamble text', () => {
    const input = 'Here is my plan:\n\n{"tasks": [{"id": "x"}]}\n\nHope this helps!'
    expect(extractJson(input)).toEqual({ tasks: [{ id: 'x' }] })
  })

  test('fixes trailing commas', () => {
    const input = '{"tasks": [{"id": "a",},],}'
    expect(extractJson(input)).toEqual({ tasks: [{ id: 'a' }] })
  })

  test('throws for non-JSON text', () => {
    expect(() => extractJson('no json here')).toThrow('Could not extract valid JSON')
  })

  test('throws for empty input', () => {
    expect(() => extractJson('')).toThrow()
  })

  test('handles inner code fences', () => {
    const input = '```json\n{"key":"value with ```bash\\npnpm dev\\n``` inside"}\n```'
    const result = extractJson(input)
    expect(result).toHaveProperty('key')
  })
})

describe('parseOpenHivePlan', () => {
  test('parses valid plan', () => {
    const plan = parseOpenHivePlan({
      tasks: [{ id: 'a', kind: 'analysis', title: 'A', prompt: 'do A' }],
    })
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0].id).toBe('a')
  })

  test('deduplicates task IDs', () => {
    const plan = parseOpenHivePlan({
      tasks: [
        { id: 'a', kind: 'general', title: 'First', prompt: 'first' },
        { id: 'a', kind: 'general', title: 'Duplicate', prompt: 'duplicate' },
        { id: 'b', kind: 'general', title: 'B', prompt: 'do B' },
      ],
    })
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0].title).toBe('First')
  })

  test('removes invalid dependency references', () => {
    const plan = parseOpenHivePlan({
      tasks: [{ id: 'a', kind: 'general', title: 'A', prompt: 'do A', dependsOn: ['nonexistent'] }],
    })
    expect(plan.tasks[0].dependsOn).toEqual([])
  })

  test('removes self-referencing dependencies', () => {
    const plan = parseOpenHivePlan({
      tasks: [{ id: 'a', kind: 'general', title: 'A', prompt: 'do A', dependsOn: ['a'] }],
    })
    expect(plan.tasks[0].dependsOn).toEqual([])
  })

  test('coerces unknown task kind to general', () => {
    const plan = parseOpenHivePlan({
      tasks: [{ id: 'a', kind: 'unknown-kind', title: 'A', prompt: 'do A' }],
    })
    expect(plan.tasks[0].kind).toBe('general')
  })

  test('extracts valid tasks from partially invalid array', () => {
    const plan = parseOpenHivePlan({
      tasks: [
        { id: 'good', kind: 'general', title: 'Good', prompt: 'valid task' },
        { id: '', kind: 'general', title: 'Bad', prompt: 'empty id' },
        { id: 'no-prompt', kind: 'general', title: 'No prompt' },
        null,
        42,
      ],
    })
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0].id).toBe('good')
  })

  test('uses id as title fallback when title is missing', () => {
    const plan = parseOpenHivePlan({
      tasks: [{ id: 'my-task', kind: 'general', prompt: 'do something' }],
    })
    expect(plan.tasks[0].title).toBe('my-task')
  })

  test('throws when no valid tasks can be extracted', () => {
    expect(() => parseOpenHivePlan({ tasks: [] })).toThrow(OpenHivePlanValidationError)
    expect(() => parseOpenHivePlan({ tasks: [null, {}] })).toThrow(OpenHivePlanValidationError)
    expect(() => parseOpenHivePlan(null)).toThrow(OpenHivePlanValidationError)
    expect(() => parseOpenHivePlan('string')).toThrow(OpenHivePlanValidationError)
  })

  test('truncates plans exceeding max task count', () => {
    const tasks = Array.from({ length: 15 }, (_, i) => ({
      id: `task-${i}`,
      kind: 'general',
      title: `Task ${i}`,
      prompt: `Do ${i}`,
    }))
    const plan = parseOpenHivePlan({ tasks })
    expect(plan.tasks.length).toBeLessThanOrEqual(MAX_PLAN_TASKS)
  })
})
