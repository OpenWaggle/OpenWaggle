/**
 * The Session Host the boot shim launched for this GUI before the main bundle loaded
 * (src/main/boot/session-host-prelaunch.ts), handed to the GUI's Host startup, which waits for it
 * instead of launching its own. The shim and the main bundle are built separately, so the record
 * travels on `globalThis` under a registered symbol both copies of this module agree on.
 */
import path from 'node:path'

const PRELAUNCH_KEY = Symbol.for('openwaggle.session-host-prelaunch')

export interface SessionHostPrelaunch {
  /** The profile the Host was launched for; a GUI that resolves another one ignores it. */
  readonly userDataRoot: string
  /** Settles once the launched process has exited, or could not be started. */
  readonly ended: Promise<void>
  readonly hasEnded: () => boolean
}

type PrelaunchScope = object

function isSessionHostPrelaunch(value: unknown): value is SessionHostPrelaunch {
  return (
    typeof value === 'object' &&
    value !== null &&
    'userDataRoot' in value &&
    typeof value.userDataRoot === 'string' &&
    'ended' in value &&
    value.ended instanceof Promise &&
    'hasEnded' in value &&
    typeof value.hasEnded === 'function'
  )
}

export function recordSessionHostPrelaunch(
  prelaunch: SessionHostPrelaunch,
  scope: PrelaunchScope = globalThis,
) {
  Reflect.set(scope, PRELAUNCH_KEY, prelaunch)
}

/**
 * Whether this process launched a Host from its boot shim that nothing has taken yet, for
 * `userDataRoot` when given.
 */
export function hasSessionHostPrelaunch(userDataRoot?: string, scope: PrelaunchScope = globalThis) {
  const prelaunch: unknown = Reflect.get(scope, PRELAUNCH_KEY)
  if (!isSessionHostPrelaunch(prelaunch)) return false
  return userDataRoot === undefined || sameProfile(prelaunch.userDataRoot, userDataRoot)
}

function sameProfile(left: string, right: string) {
  return path.resolve(left) === path.resolve(right)
}

/**
 * Takes the boot shim's Host for `userDataRoot`, once: a later start (a Retry) launches as usual.
 * A Host launched for another profile, or one that already ended, is not returned.
 */
export function takeSessionHostPrelaunch(
  userDataRoot: string,
  scope: PrelaunchScope = globalThis,
): SessionHostPrelaunch | null {
  const prelaunch: unknown = Reflect.get(scope, PRELAUNCH_KEY)
  Reflect.deleteProperty(scope, PRELAUNCH_KEY)
  if (!isSessionHostPrelaunch(prelaunch)) return null
  if (!sameProfile(prelaunch.userDataRoot, userDataRoot)) return null
  return prelaunch.hasEnded() ? null : prelaunch
}
