/**
 * What the agent did during a Session, as the gate needs it: the files it changed since the last
 * passing gate, and generated files it edited by hand (TOOL-07). Pure; the Session feeds it tool
 * calls and the commands they ran.
 */
import type { CommandRun } from './commands'
import type { Finding } from './findings'
import { generatedFilesFor, ranGenerator } from './generated-files'

export interface ChangeSource {
  /** The tool that made the change: `edit`, `write`, `bash`, `codemode`... */
  readonly tool: string
  /** Shell commands the call ran, its own and any nested ones. */
  readonly commands: readonly string[]
}

export class SessionActivity {
  /** Files changed since the last passing gate. */
  readonly pending = new Set<string>()
  private readonly handEdits = new Map<string, string>()

  recordChanges(files: readonly string[], source: ChangeSource) {
    for (const file of files) {
      this.pending.add(file)
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
    }
  }

  /** The gate passed for every pending file except `unchecked`, which a tool could not check. */
  passed(unchecked: readonly string[]) {
    this.pending.clear()
    for (const file of unchecked) this.pending.add(file)
  }

  findings(): Finding[] {
    return [...this.handEdits].map(([file, how]) => ({
      file,
      rule: 'gate/generated',
      id: 'TOOL-07',
      message: `${generatedFilesFor(file)?.name ?? 'generated file'} changed by ${how}, not its generator; revert it and run the generator`,
      severity: 'block' as const,
    }))
  }
}
