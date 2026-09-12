import { describe, expect, it } from 'vitest'
import { errorMessage } from '../sidebar-action-utils'

describe('sidebar action error messages', () => {
  it.each([
    [
      new Error("Error invoking remote method 'sessions:delete': Error: Delete Workers first."),
      'Delete Workers first.',
    ],
    [
      "Error invoking remote method 'sessions:delete': Delete Workers first.",
      'Delete Workers first.',
    ],
    [new Error('Permission denied.'), 'Permission denied.'],
    [new Error('Error: a meaningful domain detail'), 'Error: a meaningful domain detail'],
    ['Request failed.', 'Request failed.'],
    [undefined, 'undefined'],
  ])('preserves the reason from %s without an IPC wrapper', (error, expected) => {
    expect(errorMessage(error)).toBe(expected)
  })
})
