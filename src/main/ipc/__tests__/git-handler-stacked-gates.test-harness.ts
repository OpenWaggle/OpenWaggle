import { execFileMock } from './git-handler.test-harness'

export type GitCallback = (error: Error | null, stdout: string, stderr: string) => void

/** Respond to the git calls a stacked action makes, failing loudly on anything unexpected. */
export function respondWith(
  handlers: ReadonlyMap<string, string>,
  onUnexpected?: (args: string) => void,
) {
  execFileMock.mockImplementation(
    (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
      const joined = args.join(' ')
      const canned = handlers.get(joined)
      if (canned !== undefined) {
        callback(null, canned, '')
        return
      }
      onUnexpected?.(joined)
      callback(new Error(`Unexpected Git arguments: ${joined}`), '', '')
    },
  )
}
