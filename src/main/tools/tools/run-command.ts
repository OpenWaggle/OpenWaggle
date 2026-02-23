import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { z } from 'zod'
import { getSafeChildEnv } from '../../env'
import { defineOpenHiveTool } from '../define-tool'

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
    const timeout = args.timeout ?? 30000
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
          if (error?.killed) {
            const truncatedCmd =
              args.command.length > 80 ? `${args.command.slice(0, 80)}...` : args.command
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
