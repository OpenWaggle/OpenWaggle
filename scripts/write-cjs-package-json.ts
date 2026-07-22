import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const JSON_INDENT_SPACES = 2
const CJS_DIST_ROOT = 'dist-cjs'

mkdirSync(CJS_DIST_ROOT, { recursive: true })
writeFileSync(
  join(CJS_DIST_ROOT, 'package.json'),
  `${JSON.stringify({ type: 'commonjs' }, null, JSON_INDENT_SPACES)}\n`,
)
