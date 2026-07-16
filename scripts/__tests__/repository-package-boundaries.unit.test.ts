import { describe, expect, it } from 'vitest'

import { collectPackageBoundaryViolations } from '../repository-package-boundaries'

describe('repository package boundaries', () => {
  it('checks executable package source but ignores documentation examples', () => {
    const contents = "import { Panel } from '@openwaggle/extension-react'"

    expect(
      collectPackageBoundaryViolations('packages/waggle-core/src/index.ts', contents),
    ).toHaveLength(1)
    expect(
      collectPackageBoundaryViolations('packages/waggle-core/README.md', contents),
    ).toEqual([])
  })
})
