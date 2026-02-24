import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { z } from 'zod'
import { getSafeChildEnv } from '../../env'
import { createLogger } from '../../logger'
import { defineOpenHiveTool } from '../define-tool'

const logger = createLogger('tools:command')

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+-rf\s+\//, description: 'recursive delete from root (/)' },
  { pattern: /rm\s+-rf\s+~/, description: 'recursive delete from home (~)' },
  { pattern: /rm\s+-rf\s+\$HOME/, description: 'recursive delete from $HOME' },
  { pattern: /curl\s.*\|\s*bash/, description: 'piping remote script to bash' },
  { pattern: /wget\s.*\|\s*sh/, description: 'piping remote script to sh' },
  { pattern: /chmod\s+777/, description: 'setting world-writable permissions' },
  { pattern: />\s*\/dev\/sda/, description: 'writing directly to disk device' },
  { pattern: /dd\s+if=/, description: 'raw disk copy (dd)' },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    description: 'fork bomb',
  },
]

export function isDangerousCommand(command: string): string | null {
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked for safety: ${description}. Rephrase the command to avoid this pattern.`
    }
  }
  return null
}

export const runCommandTool = defineOpenHiveTool({
  name: 'runCommand',
  description:
    'Run a shell command in the project directory. Use this for tasks like running tests, installing dependencies, git operations, grep, etc. The command runs in a shell.',
  needsApproval: true,
  inputSchema: z.object({
    command: z.string().describe('The shell command to run'),
    timeout: z
      .number()
      .optional()
      .describe('Timeout in milliseconds. Defaults to 30000 (30 seconds).'),
  }),
  async execute(args, context) {
    const dangerousReason = isDangerousCommand(args.command)
    if (dangerousReason) {
      logger.warn('dangerous command blocked', {
        command: args.command.slice(0, 200),
        reason: dangerousReason,
      })
      return dangerousReason
    }

    const timeout = args.timeout ?? 30000
    const truncatedCmd =
      args.command.length > 200 ? `${args.command.slice(0, 200)}...` : args.command
    logger.info('executing command', {
      command: truncatedCmd,
      cwd: context.projectPath,
      timeout,
    })
    const startTime = Date.now()
    const { shell, shellArgs } = resolveShellInvocation(args.command)

    return new Promise((resolve, reject) => {
      const proc = execFile(
        shell,
        shellArgs,
        {
          cwd: context.projectPath,
          timeout,
          maxBuffer: 1024 * 1024,
          env: getSafeChildEnv(),
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime
          if (error?.killed) {
            logger.warn('command timed out', { command: truncatedCmd, durationMs, timeout })
            reject(
              new Error(
                `Command "${truncatedCmd}" timed out after ${timeout}ms. Try a shorter command or increase the timeout.`,
              ),
            )
            return
          }

          const output: string[] = []
          if (stdout.trim()) output.push(stdout.trim())
          if (stderr.trim()) output.push(`STDERR:\n${stderr.trim()}`)
          if (error) output.push(`Exit code: ${error.code}`)

          logger.info('command completed', {
            command: truncatedCmd,
            exitCode: error?.code ?? 0,
            durationMs,
            stdoutSize: stdout.length,
            stderrSize: stderr.length,
          })

          resolve(output.join('\n\n') || '(no output)')
        },
      )

      if (context.signal) {
        context.signal.addEventListener('abort', () => proc.kill())
      }
    })
  },
})

function resolveShellInvocation(command: string): { shell: string; shellArgs: string[] } {
  if (os.platform() === 'win32') {
    return {
      shell: 'cmd.exe',
      shellArgs: ['/d', '/s', '/c', command],
    }
  }

  if (fs.existsSync('/bin/bash')) {
    return {
      shell: '/bin/bash',
      shellArgs: ['-lc', command],
    }
  }

  return {
    shell: '/bin/sh',
    shellArgs: ['-c', command],
  }
}
