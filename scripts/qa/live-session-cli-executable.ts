import fs from 'node:fs/promises'
import path from 'node:path'
import { managedCliShimContent } from '../../src/main/services/cli-shim-content'

const EXECUTABLE_FILE_MODE = 0o700

export async function prepareLiveQaCliExecutable(input: {
  readonly executable: string
  readonly workingDirectory: string
  readonly platform?: NodeJS.Platform
}) {
  const platform = input.platform ?? process.platform
  if (platform !== 'linux') return input.executable
  const command = path.join(input.workingDirectory, 'openwaggle-live-qa-cli')
  await fs.writeFile(
    command,
    managedCliShimContent({
      platform,
      homeDirectory: input.workingDirectory,
      executablePath: input.executable,
    }),
    { mode: EXECUTABLE_FILE_MODE },
  )
  return command
}
