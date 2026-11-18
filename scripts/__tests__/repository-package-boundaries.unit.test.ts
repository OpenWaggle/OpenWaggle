import { describe, expect, it } from 'vitest'

import { collectPackageBoundaryViolations } from '../repository-package-boundaries'

describe('repository package boundaries', () => {
  it('checks executable package source but ignores documentation examples', () => {
    const contents = "import { Panel } from '@openwaggle/extension-react'"

    expect(
      collectPackageBoundaryViolations('packages/waggle-core/src/index.ts', contents),
    ).toHaveLength(1)
    expect(collectPackageBoundaryViolations('packages/waggle-core/README.md', contents)).toEqual([])
  })

  it.each([
    '@openwaggle/extension-sdk/internal/manifest-schemas',
    '@openwaggle/extension-sdk/testing',
    '@openwaggle/extension-sdk/validation',
  ])('keeps extension-react off the SDK entry %s', (specifier) => {
    expect(
      collectPackageBoundaryViolations(
        'packages/extension-react/src/index.ts',
        `import { x } from '${specifier}'`,
      ),
    ).toEqual([expect.objectContaining({ detail: specifier })])
  })

  it.each(['@openwaggle/extension-sdk', '@openwaggle/extension-sdk/theme'])(
    'lets extension-react import the SDK runtime entry %s',
    (specifier) => {
      expect(
        collectPackageBoundaryViolations(
          'packages/extension-react/src/index.ts',
          `import { x } from '${specifier}'`,
        ),
      ).toEqual([])
    },
  )
})
