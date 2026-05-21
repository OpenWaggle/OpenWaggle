import { describe, expect, it } from 'vitest'
import { isReactElementWithProps } from '../react-element-guard'

describe('isReactElementWithProps', () => {
  it('returns true for an object that has a props property', () => {
    const mockElement = { type: 'div', props: { className: 'foo' }, key: null }
    expect(isReactElementWithProps(mockElement)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isReactElementWithProps(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isReactElementWithProps(undefined)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isReactElementWithProps('hello')).toBe(false)
  })

  it('returns false for a number', () => {
    expect(isReactElementWithProps(42)).toBe(false)
  })

  it('returns false for an array', () => {
    const arr = [{ type: 'div', props: {}, key: null }]
    expect(isReactElementWithProps(arr)).toBe(false)
  })

  it('returns false for an object without a props property', () => {
    const obj = { type: 'div', key: null }
    expect(isReactElementWithProps(obj)).toBe(false)
  })
})
