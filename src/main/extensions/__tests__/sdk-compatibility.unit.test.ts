import { describe, expect, it } from 'vitest'
import { checkExtensionSdkCompatibility } from '../sdk-compatibility'

describe('checkExtensionSdkCompatibility', () => {
  it('accepts exact, caret, tilde, and comparator ranges that include the host SDK', () => {
    expect(checkExtensionSdkCompatibility('0.1.0', '0.1.0').compatible).toBe(true)
    expect(checkExtensionSdkCompatibility('^0.1.0', '0.1.5').compatible).toBe(true)
    expect(checkExtensionSdkCompatibility('~0.1.0', '0.1.5').compatible).toBe(true)
    expect(checkExtensionSdkCompatibility('>=0.1.0 <0.2.0', '0.1.0').compatible).toBe(true)
  })

  it('rejects ranges that exclude the host SDK', () => {
    const result = checkExtensionSdkCompatibility('>=0.2.0 <0.3.0', '0.1.0')

    expect(result.compatible).toBe(false)
    expect(result.reason).toContain('does not satisfy')
  })

  it('keeps the strictest repeated comparator bounds regardless of order', () => {
    expect(checkExtensionSdkCompatibility('>=0.2.0 >=0.1.0', '0.1.5').compatible).toBe(false)
    expect(checkExtensionSdkCompatibility('<=0.3.0 <=0.2.0', '0.2.5').compatible).toBe(false)
    expect(checkExtensionSdkCompatibility('>=0.1.0 >0.1.0', '0.1.0').compatible).toBe(false)
  })

  it('rejects unsupported SDK range syntax', () => {
    const result = checkExtensionSdkCompatibility('latest', '0.1.0')

    expect(result.compatible).toBe(false)
    expect(result.reason).toContain('not supported')
  })
})
