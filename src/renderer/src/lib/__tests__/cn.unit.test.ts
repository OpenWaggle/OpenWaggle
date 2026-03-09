import { describe, expect, it } from 'vitest'
import { cn } from '../cn'

describe('cn', () => {
  it('joins multiple string inputs with a space', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz')
  })

  it('filters out false, null, and undefined values', () => {
    expect(cn('base', false, null, undefined, 'active')).toBe('base active')
  })

  it('returns an empty string when all inputs are falsy', () => {
    expect(cn(false, null, undefined)).toBe('')
  })

  it('returns an empty string when called with no arguments', () => {
    expect(cn()).toBe('')
  })

  it('preserves a single class name', () => {
    expect(cn('only')).toBe('only')
  })

  it('supports conditional class expressions', () => {
    const isActive = true
    const isDisabled = false
    expect(cn('btn', isActive && 'btn-active', isDisabled && 'btn-disabled')).toBe('btn btn-active')
  })
})
