interface CliOutputStream {
  readonly write: (chunk: string, callback: (error?: Error | null) => void) => boolean
}

function flushStream(stream: CliOutputStream) {
  return new Promise<void>((resolve, reject) => {
    stream.write('', (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/** Electron's forceful app.exit() does not wait for piped machine output to drain. */
export function flushCliOutput(
  output: { readonly stdout: CliOutputStream; readonly stderr: CliOutputStream } = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
) {
  return Promise.all([flushStream(output.stdout), flushStream(output.stderr)]).then(() => undefined)
}
