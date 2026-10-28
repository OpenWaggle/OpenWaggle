import fs from 'node:fs/promises'
import path from 'node:path'
import { STARTUP_APPEARANCE_SCRIPT_HASH } from '../src/main/security/electron-security'
import { inlineScriptHashFailures } from './renderer-inline-scripts'

const BUILT_RENDERER_PAGE = 'out/renderer/index.html'

async function main() {
  const html = await fs.readFile(path.resolve(BUILT_RENDERER_PAGE), 'utf8')
  const failures = inlineScriptHashFailures({
    html,
    page: BUILT_RENDERER_PAGE,
    allowedHash: STARTUP_APPEARANCE_SCRIPT_HASH,
  })
  if (failures.length > 0) throw new Error(failures.join('\n'))
  process.stdout.write(`${BUILT_RENDERER_PAGE}: its inline script matches the CSP hash\n`)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
