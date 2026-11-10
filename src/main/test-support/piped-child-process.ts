import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'

/** A `ChildProcess` with in-memory pipes, for tests that hand it out from a mocked `spawn`. */
export type PipedChildProcess = ChildProcess & {
  readonly stdin: PassThrough
  readonly stdout: PassThrough
  readonly stderr: PassThrough
}

function hasPipes(child: ChildProcess): child is PipedChildProcess {
  return (
    child.stdin instanceof PassThrough &&
    child.stdout instanceof PassThrough &&
    child.stderr instanceof PassThrough
  )
}

/**
 * Defines the pipes as own properties. Assigning them does not work everywhere: on Bun they are
 * getters without setters on `ChildProcess.prototype`.
 */
export function pipedChildProcess(): PipedChildProcess {
  const child = new ChildProcess()
  const pipe = () => ({ value: new PassThrough(), configurable: true, enumerable: true })
  Object.defineProperties(child, { stdin: pipe(), stdout: pipe(), stderr: pipe() })
  if (!hasPipes(child)) throw new Error('The fake child process did not take its pipes.')
  return child
}
