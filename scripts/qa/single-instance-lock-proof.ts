import fs from 'node:fs/promises'
import path from 'node:path'

const LOCK_DENIED_MARKER_FILE = 'automation-single-instance-lock-denied'
const LOCK_DENIED_MARKER_SWITCH = 'openwaggle-automation-single-instance-lock-denied-marker'
const LOCK_DENIED_MARKER_CONTENT = 'single-instance-lock-denied\n'

export function singleInstanceLockDeniedMarkerPath(userDataRoot: string) {
  return path.join(userDataRoot, LOCK_DENIED_MARKER_FILE)
}

export function singleInstanceLockDeniedArguments(markerPath: string) {
  return [`--${LOCK_DENIED_MARKER_SWITCH}=${markerPath}`]
}

export async function assertSingleInstanceLockDeniedMarker(markerPath: string) {
  let contents: string
  try {
    contents = await fs.readFile(markerPath, 'utf8')
  } catch (error) {
    throw new Error('The second packaged GUI did not prove single-instance lock denial.', {
      cause: error,
    })
  }
  if (contents !== LOCK_DENIED_MARKER_CONTENT) {
    throw new Error('The second packaged GUI wrote an invalid single-instance lock-denied marker.')
  }
}
