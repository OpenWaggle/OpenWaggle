import type { spawn } from 'node:child_process'

type SpawnedChild = ReturnType<typeof spawn>

export function waitForChildExit(child: SpawnedChild) {
  return new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
}

export async function releaseValidatedChild(input: {
  readonly child: SpawnedChild
  readonly label: string
  readonly afterValidation?: () => Promise<void>
}) {
  await new Promise<void>((resolve, reject) => {
    let ready = false
    input.child.stdout?.once('data', () => {
      ready = true
      resolve()
    })
    input.child.once('error', reject)
    input.child.once('close', (code) => {
      if (!ready) reject(new Error(`${input.label} exited before validation (${code}).`))
    })
  })
  try {
    await input.afterValidation?.()
    input.child.stdin?.end('\n')
  } catch (error) {
    input.child.stdin?.destroy()
    input.child.kill()
    throw error
  }
}

export async function abortValidatedChild(
  child: SpawnedChild,
  exitCodePromise: Promise<number | null>,
) {
  child.stdin?.destroy()
  child.kill()
  await exitCodePromise.catch(() => undefined)
}
