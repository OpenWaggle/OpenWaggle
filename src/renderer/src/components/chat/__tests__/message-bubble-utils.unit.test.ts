import type { UIMessage } from '@tanstack/ai-react'
import { describe, expect, it } from 'vitest'
import {
  countQuestions,
  countToolCallParts,
  getLastRenderableTextPartIndex,
  getStringProperty,
  getTasksProperty,
  hasRenderableTextPartBeforeIndex,
  isOrchestrateTaskArg,
  isRenderableTextPart,
  parseOrchestrateTasks,
  parsePlanAction,
  parsePlanText,
} from '../message-bubble-utils'

type MessagePart = UIMessage['parts'][number]

function textPart(content: string): MessagePart {
  return { type: 'text', content }
}

function toolCallPart(name: string, id = 'tc-1'): MessagePart {
  return {
    type: 'tool-call',
    id,
    name,
    arguments: '{}',
    state: 'output-available',
  }
}

describe('isRenderableTextPart', () => {
  it('returns true for non-empty text part', () => {
    expect(isRenderableTextPart(textPart('hello'))).toBe(true)
  })

  it('returns false for empty text part', () => {
    expect(isRenderableTextPart(textPart(''))).toBe(false)
  })

  it('returns false for whitespace-only text part', () => {
    expect(isRenderableTextPart(textPart('   \n\t  '))).toBe(false)
  })

  it('returns false for non-text part', () => {
    expect(isRenderableTextPart(toolCallPart('readFile'))).toBe(false)
  })
})

describe('getLastRenderableTextPartIndex', () => {
  it('returns index of the last non-empty text part', () => {
    const parts: UIMessage['parts'] = [textPart('first'), toolCallPart('run'), textPart('last')]
    expect(getLastRenderableTextPartIndex(parts)).toBe(2)
  })

  it('skips trailing empty text parts', () => {
    const parts: UIMessage['parts'] = [textPart('only'), textPart('')]
    expect(getLastRenderableTextPartIndex(parts)).toBe(0)
  })

  it('returns -1 when no renderable text parts exist', () => {
    const parts: UIMessage['parts'] = [toolCallPart('run'), textPart('')]
    expect(getLastRenderableTextPartIndex(parts)).toBe(-1)
  })

  it('returns -1 for empty parts array', () => {
    expect(getLastRenderableTextPartIndex([])).toBe(-1)
  })
})

describe('countToolCallParts', () => {
  it('counts tool-call parts correctly', () => {
    const parts: UIMessage['parts'] = [
      textPart('hi'),
      toolCallPart('readFile', 'tc-1'),
      toolCallPart('writeFile', 'tc-2'),
    ]
    expect(countToolCallParts(parts)).toBe(2)
  })

  it('excludes _turnBoundary tool calls', () => {
    const parts: UIMessage['parts'] = [
      toolCallPart('readFile', 'tc-1'),
      toolCallPart('_turnBoundary', 'tc-2'),
    ]
    expect(countToolCallParts(parts)).toBe(1)
  })

  it('returns 0 when no tool-call parts exist', () => {
    const parts: UIMessage['parts'] = [textPart('hello')]
    expect(countToolCallParts(parts)).toBe(0)
  })
})

describe('hasRenderableTextPartBeforeIndex', () => {
  it('returns true when a renderable text part exists before index', () => {
    const parts: UIMessage['parts'] = [textPart('first'), toolCallPart('run'), textPart('last')]
    expect(hasRenderableTextPartBeforeIndex(parts, 2)).toBe(true)
  })

  it('returns false when no renderable text part exists before index', () => {
    const parts: UIMessage['parts'] = [toolCallPart('run'), textPart('only')]
    expect(hasRenderableTextPartBeforeIndex(parts, 1)).toBe(false)
  })

  it('returns false when index is 0', () => {
    const parts: UIMessage['parts'] = [textPart('first')]
    expect(hasRenderableTextPartBeforeIndex(parts, 0)).toBe(false)
  })

  it('returns false when index is negative', () => {
    const parts: UIMessage['parts'] = [textPart('first')]
    expect(hasRenderableTextPartBeforeIndex(parts, -1)).toBe(false)
  })
})

describe('countQuestions', () => {
  it('counts questions from valid askUser args JSON', () => {
    const args = JSON.stringify({
      questions: [
        { question: 'Q1?', options: [{ label: 'Yes' }] },
        { question: 'Q2?', options: [{ label: 'No' }] },
      ],
    })
    expect(countQuestions(args)).toBe(2)
  })

  it('returns 1 as fallback on invalid JSON', () => {
    expect(countQuestions('not json')).toBe(1)
  })

  it('returns 1 as fallback on schema mismatch', () => {
    expect(countQuestions(JSON.stringify({ wrong: 'shape' }))).toBe(1)
  })
})

describe('parsePlanText', () => {
  it('parses planText from valid args JSON', () => {
    const args = JSON.stringify({ planText: 'Do step 1 then step 2' })
    expect(parsePlanText(args)).toBe('Do step 1 then step 2')
  })

  it('returns empty string when planText is missing', () => {
    expect(parsePlanText(JSON.stringify({}))).toBe('')
  })

  it('returns empty string on invalid JSON', () => {
    expect(parsePlanText('{{bad')).toBe('')
  })
})

describe('parsePlanAction', () => {
  it('parses approve action from object', () => {
    expect(parsePlanAction({ action: 'approve' })).toBe('approve')
  })

  it('parses revise action from object', () => {
    expect(parsePlanAction({ action: 'revise', feedback: 'fix this' })).toBe('revise')
  })

  it('parses from JSON string', () => {
    expect(parsePlanAction(JSON.stringify({ action: 'approve' }))).toBe('approve')
  })

  it('returns approve as fallback for invalid input', () => {
    expect(parsePlanAction('not valid')).toBe('approve')
  })

  it('returns approve as fallback for null', () => {
    expect(parsePlanAction(null)).toBe('approve')
  })
})

describe('parseOrchestrateTasks', () => {
  it('parses valid tasks array', () => {
    const args = JSON.stringify({
      tasks: [
        { id: 't1', title: 'Task 1' },
        { id: 't2', title: 'Task 2' },
      ],
    })
    expect(parseOrchestrateTasks(args)).toEqual([
      { id: 't1', title: 'Task 1' },
      { id: 't2', title: 'Task 2' },
    ])
  })

  it('filters out invalid task entries', () => {
    const args = JSON.stringify({
      tasks: [{ id: 't1', title: 'Valid' }, { broken: true }, { id: 't2' }],
    })
    expect(parseOrchestrateTasks(args)).toEqual([{ id: 't1', title: 'Valid' }])
  })

  it('returns empty array on invalid JSON', () => {
    expect(parseOrchestrateTasks('not json')).toEqual([])
  })

  it('returns empty array when tasks key is missing', () => {
    expect(parseOrchestrateTasks(JSON.stringify({}))).toEqual([])
  })
})

describe('getStringProperty', () => {
  it('returns string value for existing property', () => {
    expect(getStringProperty({ name: 'test' }, 'name')).toBe('test')
  })

  it('returns null for non-string property', () => {
    expect(getStringProperty({ count: 42 }, 'count')).toBeNull()
  })

  it('returns null for missing property', () => {
    expect(getStringProperty({}, 'missing')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(getStringProperty(null, 'key')).toBeNull()
  })

  it('returns null for primitive input', () => {
    expect(getStringProperty('hello', 'length')).toBeNull()
  })
})

describe('getTasksProperty', () => {
  it('returns filtered tasks array for valid input', () => {
    const value = { tasks: [{ id: '1', title: 'A' }] }
    expect(getTasksProperty(value)).toEqual([{ id: '1', title: 'A' }])
  })

  it('returns null when tasks is not an array', () => {
    expect(getTasksProperty({ tasks: 'not array' })).toBeNull()
  })

  it('returns null for null input', () => {
    expect(getTasksProperty(null)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(getTasksProperty(42)).toBeNull()
  })

  it('returns empty array when all tasks are invalid', () => {
    expect(getTasksProperty({ tasks: [{ broken: true }] })).toEqual([])
  })
})

describe('isOrchestrateTaskArg', () => {
  it('returns true for valid task arg', () => {
    expect(isOrchestrateTaskArg({ id: 't1', title: 'My Task' })).toBe(true)
  })

  it('returns false when id is missing', () => {
    expect(isOrchestrateTaskArg({ title: 'No ID' })).toBe(false)
  })

  it('returns false when title is missing', () => {
    expect(isOrchestrateTaskArg({ id: 't1' })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isOrchestrateTaskArg(null)).toBe(false)
  })

  it('returns false for non-object', () => {
    expect(isOrchestrateTaskArg('string')).toBe(false)
  })
})
