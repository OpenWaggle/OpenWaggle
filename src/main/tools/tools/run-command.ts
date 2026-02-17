import { execFile } from 'node:child_process'
import { z } from 'zod'
import { getSafeChildEnv } from '../../env'
import { defineHiveCodeTool } from '../define-tool'

export const runCommandTool = defineHiveCodeTool({
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

    return new Promise((resolve, reject) => {
      const proc = execFile(
        '/bin/sh',
        ['-c', args.command],
        {
          cwd: context.projectPath,
          timeout,
          maxBuffer: 1024 * 1024,
          env: getSafeChildEnv(),
        },
        (error, stdout, stderr) => {
          if (error?.killed) {
            reject(new Error(`Command timed out after ${timeout}ms`))
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
