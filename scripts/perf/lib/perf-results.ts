import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const JSON_INDENT = 2

function gitValue(args: readonly string[]) {
  try {
    return execFileSync('git', [...args], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Where and on what a measurement ran, so results from different days stay comparable. */
export function measurementEnvironment() {
  const cpus = os.cpus()
  return {
    measuredAt: new Date().toISOString(),
    repositoryCommit: gitValue(['rev-parse', 'HEAD']),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: cpus[0]?.model ?? 'unknown',
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    loadAverage: os.loadavg(),
    node: process.version,
  }
}

export async function writeJsonResult(directory: string, name: string, value: unknown) {
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, name)
  await writeFile(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`)
  return file
}

export function log(message: string) {
  process.stderr.write(`${message}\n`)
}
