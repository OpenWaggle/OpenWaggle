import { describe, expect, it } from 'vitest'
import { shouldEnforceLargeSourceLongTaskBudget } from './performance-budgets'

describe('large-source renderer performance budgets', () => {
  it.each([
    ['local Windows', 'false', 'self-hosted', 'win32', true],
    ['hosted Linux', 'true', 'github-hosted', 'linux', true],
    ['hosted Windows', 'true', 'github-hosted', 'win32', false],
  ] as const)(
    'sets absolute long-task enforcement for %s',
    (_name, githubActions, runnerEnvironment, platform, expected) => {
      expect(
        shouldEnforceLargeSourceLongTaskBudget({
          githubActions,
          platform,
          runnerEnvironment,
        }),
      ).toBe(expected)
    },
  )
})
