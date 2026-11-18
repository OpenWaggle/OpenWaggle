import { describe, expect, it } from 'vitest'
import { enableEscapedExecCapture } from '../preparation-escaped-exec'

describe('builtin option terminator', () => {
  it('preserves command position for escaped exec and eval after builtin --', () => {
    const command = [
      String.raw`builtin -- \exec /usr/bin/true`,
      String.raw`\builtin -- \exec /usr/bin/true`,
      String.raw`builtin -- \eval "$code"`,
      String.raw`builtin -- -- \eval "$code"`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command
        .replaceAll(String.raw`\exec /usr/bin/true`, 'exec /usr/bin/true')
        .replace(String.raw`builtin -- \eval "$code"`, 'builtin -- __ow_eval "$code"'),
    )
  })
})
