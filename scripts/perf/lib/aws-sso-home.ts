/**
 * Gives a throwaway test HOME the AWS configuration an SSO profile needs, as copies the test cannot
 * write back through: `config` and the SSO token cache, each 0400. Long-lived keys
 * (`credentials`) are never copied, and nothing links back to the real home (MEMORY: tests never
 * point a home back at the real one). The AWS SDK swallows a failed write of a refreshed token.
 */
import { chmod, copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

const READ_ONLY_FILE = 0o400
const PRIVATE_DIRECTORY = 0o700

async function copyReadOnly(source: string, target: string) {
  await copyFile(source, target)
  await chmod(target, READ_ONLY_FILE)
}

/** Copies `<realHome>/.aws/config` and `<realHome>/.aws/sso/cache/*` into `<home>/.aws`. */
export async function copyAwsSsoConfiguration(realHome: string, home: string) {
  const source = path.join(realHome, '.aws')
  const target = path.join(home, '.aws')
  const cache = path.join('sso', 'cache')
  await mkdir(path.join(target, cache), { recursive: true, mode: PRIVATE_DIRECTORY })
  await copyReadOnly(path.join(source, 'config'), path.join(target, 'config'))
  const cached = await readdir(path.join(source, cache), { withFileTypes: true }).catch(() => [])
  for (const entry of cached) {
    if (entry.isFile()) await copyReadOnly(path.join(source, cache, entry.name), path.join(target, cache, entry.name))
  }
}
