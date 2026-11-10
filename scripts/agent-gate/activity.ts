/**
 * What the agent did during a Session, as the gate needs it: the files it changed since the last
 * passing gate, generated files it edited by hand (TOOL-07), and source changes not followed by a
 * passing test run (TEST-05). Pure; the Session feeds it tool calls and command results.
 */
import { isTestCommand, type CommandRun } from './commands'
import type { Finding } from './findings'
import { generatedFilesFor, ranGenerator } from './generated-files'

/** Source that a test run should cover after it changes. */
const SOURCE_FILE =
  /^(?:src|packages|scripts|functions|website\/src|\.pi\/extensions)\/.*\.(?:[cm]?[jt]sx?)$/u
const NOT_SOURCE = /\.d\.ts$|^scripts\/api-snapshots\//u

export function isSourceFile(file: string) {
  return SOURCE_FILE.test(file) && !NOT_SOURCE.test(file)
}

export interface ChangeSource {
  /** The tool that made the change: `edit`, `write`, `bash`, `codemode`... */
  readonly tool: string
  /** Shell commands the call ran, its own and any nested ones. */
  readonly commands: readonly string[]
}

export class SessionActivity {
  /** Files changed since the last passing gate. */
  readonly pending = new Set<string>()
  /** Every file the agent changed in the Session. */
  readonly sessionFiles = new Set<string>()
  private readonly handEdits = new Map<string, string>()
  private readonly untested = new Set<string>()
  private failedTest: string | undefined = undefined

  recordChanges(files: readonly string[], source: ChangeSource) {
    for (const file of files) {
      this.pending.add(file)
      this.sessionFiles.add(file)
      if (isSourceFile(file)) this.untested.add(file)
      if (generatedFilesFor(file) === undefined) continue
      if (ranGenerator(file, source.commands)) {
        this.handEdits.delete(file)
      } else {
        const how =
          source.commands.length > 0
            ? `\`${source.commands.at(-1) ?? ''}\``
            : `the ${source.tool} tool`
        this.handEdits.set(file, how)
      }
    }
  }

  /** Commands that finished; call after recordChanges for the same tool call. */
  recordCommands(runs: readonly CommandRun[]) {
    for (const run of runs) {
      for (const file of [...this.handEdits.keys()]) {
        if (ranGenerator(file, [run.command])) this.handEdits.delete(file)
      }
      if (!isTestCommand(run.command)) continue
      if (run.failed) {
        this.failedTest = run.command
      } else {
        this.failedTest = undefined
        this.untested.clear()
      }
    }
  }

  /** The gate passed for every pending file except `unchecked`, which a tool could not check. */
  passed(unchecked: readonly string[]) {
    this.pending.clear()
    for (const file of unchecked) this.pending.add(file)
  }

  findings(): Finding[] {
    const generated = [...this.handEdits].map(([file, how]) => ({
      file,
      rule: 'gate/generated',
      id: 'TOOL-07',
      message: `${generatedFilesFor(file)?.name ?? 'generated file'} changed by ${how}, not its generator; revert it and run the generator`,
      severity: 'block' as const,
    }))
    return [...generated, ...this.testFindings()]
  }

  private testFindings(): Finding[] {
    const untested = [...this.untested].sort()
    const first = untested[0]
    // A failing run with no untested change since the last passing one is not the agent's to fix.
    if (first === undefined) return []
    if (this.failedTest !== undefined) {
      return [
        {
          file: first,
          rule: 'gate/tests',
          id: 'TEST-05',
          message: `the last test run failed (\`${this.failedTest}\`); fix it and run the tests again`,
          severity: 'block',
        },
      ]
    }
    const others = untested.length > 1 ? ` and ${untested.length - 1} more source files` : ''
    return [
      {
        file: first,
        rule: 'gate/tests',
        id: 'TEST-05',
        message: `changed${others} with no test run since; run the tests that cover them`,
        severity: 'block',
      },
    ]
  }
}
