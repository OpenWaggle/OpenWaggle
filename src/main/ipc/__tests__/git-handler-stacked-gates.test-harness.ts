import { execFileMock } from './git-handler.test-harness'

/** Read-only lookups the source-control resolver makes (ADR 0048); none can change the repository. */
const SOURCE_CONTROL_RESOLVER_READS = [
  /^rev-parse --path-format=absolute --git-common-dir$/u,
  /^config --get-regexp \^credential/u,
  /^-G -- /u,
]

/** Whether a git call is one of the resolver's read-only lookups rather than a mutation. */
export function isSourceControlResolverRead(joined: string) {
  return SOURCE_CONTROL_RESOLVER_READS.some((pattern) => pattern.test(joined))
}

/** The resolver treats a failed lookup as "not configured". */
export function answerResolverReadAsUnconfigured(callback: GitCallback) {
  callback(Object.assign(new Error('Not configured'), { code: 1, stdout: '', stderr: '' }), '', '')
}

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
      if (SOURCE_CONTROL_RESOLVER_READS.some((pattern) => pattern.test(joined))) {
        callback(
          Object.assign(new Error('Not configured'), { code: 1, stdout: '', stderr: '' }),
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
