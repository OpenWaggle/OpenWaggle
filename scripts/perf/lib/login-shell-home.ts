import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/** How long the real-ish login shell takes to start, like a `.zshrc` with nvm or a prompt theme. */
const LOGIN_SHELL_SLEEP_SECONDS = 0.3

/**
 * Makes a throwaway HOME's login shell like a real user's: zsh reads a `.zshrc` that takes 0.3 s
 * and exports the measuring shell's PATH. The desktop app probes the login shell for its
 * environment at launch, so a fresh HOME with no `.zshrc` hides what that probe costs.
 */
export async function writeSlowLoginShellHome(home: string) {
  const lines = [
    '# A real-ish login shell for measurements: slow to start, with the user PATH.',
    `sleep ${String(LOGIN_SHELL_SLEEP_SECONDS)}`,
    `export PATH=${JSON.stringify(process.env.PATH ?? '/usr/bin:/bin')}`,
    '',
  ]
  await writeFile(path.join(home, '.zshrc'), lines.join('\n'))
}
