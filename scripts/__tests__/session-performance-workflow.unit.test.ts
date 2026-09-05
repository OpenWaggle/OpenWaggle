import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = process.cwd()
const PACKAGE_JSON = fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')
const WORKFLOW = fs.readFileSync(
  path.join(PROJECT_ROOT, '.github/workflows/session-performance.yml'),
  'utf8',
)

describe('Session Performance workflow', () => {
  it('enforces the ten-million-message release corpus', () => {
    expect(WORKFLOW).toContain('pnpm benchmark:session-release')
    expect(WORKFLOW).not.toContain('pnpm benchmark:session-performance')
    expect(PACKAGE_JSON).toContain(
      '"benchmark:session-release": "pnpm benchmark:session-embedding && pnpm benchmark:session-vector-index && pnpm benchmark:session-database"',
    )
  })
})
