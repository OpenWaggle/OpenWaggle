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
      if (joined === 'config --get-all push.default') {
        callback(null, 'current\n', '')
        return
      }
      if (joined.startsWith('config --get-all ')) {
        callback(
          Object.assign(new Error('Config key is not set'), { code: 1, stdout: '', stderr: '' }),
          '',
          '',
        )
        return
      }
      onUnexpected?.(joined)
      callback(new Error(`Unexpected Git arguments: ${joined}`), '', '')
    },
  )
}
