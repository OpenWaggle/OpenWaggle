import { describe, expect, it } from 'vitest'
import { choose, chooseBy, Rule } from '../decision'

describe('decision utility', () => {
  it('maps literals through choose', () => {
    const status = 'M'

    const result = choose(status)
      .case('M', () => 'modified')
      .case('A', () => 'added')
      .catchAll(() => 'unknown')

    expect(result).toBe('modified')
  })

  it('supports object patterns and guard rules', () => {
    const payload: { type: 'ok' } | { type: 'error'; message: string } = {
      type: 'error',
      message: 'boom',
    }

    const result = choose(payload)
      .case(Rule.object({ type: 'ok' }), () => 'ok')
      .case(
        Rule.guard(
          (
            input,
          ): input is {
            type: 'error'
            message: string
          } => {
            if (typeof input !== 'object' || input === null) return false
            if (!('type' in input) || !('message' in input)) return false
            return input.type === 'error' && typeof input.message === 'string'
          },
        ),
        () => 'boom',
      )
      .catchAll(() => 'unknown')

    expect(result).toBe('boom')
  })

  it('supports either, exclude, and array rules', () => {
    const first = choose('warning')
      .case(Rule.either('error', 'warning'), () => 'alert')
      .catchAll(() => 'noop')

    const second = choose('info')
      .case(Rule.exclude('error'), () => 'not-error')
      .catchAll(() => 'error-only')

    const third = choose(['a', 'b', 'c'])
      .case(
        Rule.array(Rule.guard((value): value is string => typeof value === 'string')),
        () => 'ok',
      )
      .catchAll(() => 'bad')

    expect(first).toBe('alert')
    expect(second).toBe('not-error')
    expect(third).toBe('ok')
  })

  it('supports exhaustive chooseBy for discriminated unions', () => {
    type Part =
      | { type: 'text'; text: string }
      | { type: 'tool'; name: string }
      | { type: 'reasoning'; note: string }

    function getPart(): Part {
      return { type: 'tool', name: 'read' }
    }

    const part = getPart()

    const result = chooseBy(part, 'type')
      .case('text', (value) => value.text)
      .case('tool', (value) => value.name)
      .case('reasoning', (value) => value.note)
      .assertComplete()

    expect(result).toBe('read')
  })

  it('throws at runtime when assertComplete has no matching case', () => {
    const run = () =>
      choose('z')
        .case('a', () => 1)
        .assertComplete()

    expect(run).toThrowError('Decision tree was not complete for value.')
  })
})
