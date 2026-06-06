import { generateInstalledDocs } from './installed-docs-generator'

generateInstalledDocs().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
