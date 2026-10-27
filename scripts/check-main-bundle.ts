import fs from 'node:fs/promises'
import path from 'node:path'
import { disallowedTopLevelRequires, topLevelRequires } from './main-bundle-requires'

const MAIN_BUNDLE_FILES = ['out/main/index.js'] as const

async function main() {
  const failures: string[] = []
  for (const file of MAIN_BUNDLE_FILES) {
    const source = await fs.readFile(path.resolve(file), 'utf8')
    const disallowed = disallowedTopLevelRequires(source)
    if (disallowed.length > 0) {
      failures.push(
        `${file} requires ${disallowed.join(', ')} at its top level; import them where they are used, ` +
          'or route them through scripts/vite/lazy-external-requires.ts.',
      )
    }
    process.stdout.write(`${file}: ${String(topLevelRequires(source).length)} top-level requires\n`)
  }
  if (failures.length > 0) throw new Error(failures.join('\n'))
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
