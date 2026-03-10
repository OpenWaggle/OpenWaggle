import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { BYTES_PER_KIBIBYTE } from '@shared/constants/constants'
import { Schema } from '@shared/schema'
import { getSafeChildEnv } from '../../env'
import { createLogger } from '../../logger'
import { redactSensitiveText } from '../../utils/redact'
import { defineOpenWaggleTool } from '../define-tool'

const EXECUTE_VALUE_30000 = 30000
const EXECUTE_VALUE_200 = 200
const SLICE_ARG_2 = 200

const logger = createLogger('tools:runCommand')
const MAX_LOG_PREVIEW_BYTES = 1024

export const runCommandTool = defineOpenWaggleTool({
  name: 'runCommand',
  description:
    'Run a shell command in the project directory. Use this for tasks like running tests, installing dependencies, git operations, grep, etc. The command runs in a shell.',
  needsApproval: true,
  inputSchema: Schema.Struct({
    command: Schema.String.annotations({ description: 'The shell command to run' }),
    timeout: Schema.optional(
      Schema.Number.annotations({
        description: 'Timeout in milliseconds. Defaults to 30000 (30 seconds).',
      }),
    ),
  }),
  async execute(args, context) {
    const timeout = args.timeout ?? EXECUTE_VALUE_30000
    const displayCommand =
      args.command.length > EXECUTE_VALUE_200
        ? `${args.command.slice(0, SLICE_ARG_2)}...`
        : args.command
    logger.info('executing command', {
      command: redactSensitiveText(args.command),
      cwd: context.projectPath,
      timeout,
    })
    const startTime = Date.now()
    const { shell, shellArgs } = resolveShellInvocation(args.command)

    return new Promise((resolve, reject) => {
      let aborted = false
      const proc = execFile(
        shell,
        shellArgs,
        {
          cwd: context.projectPath,
          timeout,
          maxBuffer: BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
          env: getSafeChildEnv(),
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime
          if (error?.killed) {
            const killedOutcome = classifyKilledCommandOutcome({
              aborted,
              command: displayCommand,
              timeout,
            })
            logger.warn(killedOutcome.logMessage, {
              command: redactSensitiveText(args.command),
              durationMs,
              timeout,
            })
            reject(new Error(killedOutcome.userMessage))
            return
          }

          const output: string[] = []
          if (stdout.trim()) output.push(stdout.trim())
          if (stderr.trim()) output.push(`STDERR:\n${stderr.trim()}`)
          if (error) output.push(`Exit code: ${error.code}`)

          const stdoutPreview = toLogPreview(stdout)
          const stderrPreview = toLogPreview(stderr)
          logger.info('command completed', {
            command: redactSensitiveText(args.command),
            cwd: context.projectPath,
            shell,
            exitCode: error?.code ?? 0,
            durationMs,
            stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
            stderrBytes: Buffer.byteLength(stderr, 'utf8'),
            stdoutPreview: stdoutPreview.preview,
            stderrPreview: stderrPreview.preview,
            stdoutPreviewTruncated: stdoutPreview.truncated,
            stderrPreviewTruncated: stderrPreview.truncated,
          })

          resolve(output.join('\n\n') || '(no output)')
        },
      )

      if (context.signal) {
        if (context.signal.aborted) {
          aborted = true
          proc.kill()
          return
        }
        context.signal.addEventListener(
          'abort',
          () => {
            aborted = true
            proc.kill()
          },
          { once: true },
        )
      }
    })
  },
})

let cachedUnixShell: '/bin/bash' | '/bin/sh' | null = null

function getUnixShell(): '/bin/bash' | '/bin/sh' {
  if (cachedUnixShell !== null) return cachedUnixShell
  cachedUnixShell = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh'
  return cachedUnixShell
}

function resolveShellInvocation(command: string): { shell: string; shellArgs: string[] } {
  if (os.platform() === 'win32') {
    return {
      shell: 'cmd.exe',
      shellArgs: ['/d', '/s', '/c', command],
    }
  }

  const shell = getUnixShell()
  return shell === '/bin/bash'
    ? { shell, shellArgs: ['-lc', command] }
    : { shell, shellArgs: ['-c', command] }
}

interface KilledCommandOutcome {
  logMessage: 'command cancelled' | 'command timed out'
  userMessage: string
}

export function classifyKilledCommandOutcome(params: {
  aborted: boolean
  command: string
  timeout: number
}): KilledCommandOutcome {
  if (params.aborted) {
    return {
      logMessage: 'command cancelled',
      userMessage: `Command "${params.command}" was cancelled.`,
    }
  }

  return {
    logMessage: 'command timed out',
    userMessage: `Command "${params.command}" timed out after ${params.timeout}ms. Try a shorter command or increase the timeout.`,
  }
}

interface LogPreview {
  preview: string
  truncated: boolean
}

export { redactSensitiveText }

export function toLogPreview(value: string): LogPreview {
  const redacted = redactSensitiveText(value)
  const bytes = Buffer.from(redacted, 'utf8')
  if (bytes.length <= MAX_LOG_PREVIEW_BYTES) {
    return {
      preview: redacted,
      truncated: false,
    }
  }

  const preview = bytes.subarray(0, MAX_LOG_PREVIEW_BYTES).toString('utf8')
  return {
    preview: `${preview}... [truncated in log]`,
    truncated: true,
  }
}
