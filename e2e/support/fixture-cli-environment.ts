import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@playwright/test'
import { buildSafeElectronEnvironment } from '../../scripts/safe-electron-environment'
import type { OpenWaggleApp } from './openwaggle-app'

/** Keep fake CLIs authoritative even after the app hydrates its desktop shell environment. */
export async function createFixtureCliEnvironment(binPath: string) {
  const inheritedPath = buildSafeElectronEnvironment({}).PATH ?? ''
  const environment = { PATH: `${binPath}${path.delimiter}${inheritedPath}` }
  if (process.platform !== 'win32') {
    const shell = path.join(binPath, 'fixture-shell')
    // Run the actual capture command, but never read host login profiles.
    await fs.writeFile(shell, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o755 })
    return { ...environment, SHELL: shell }
  }

  const sourcePath = path.join(binPath, 'fixture-shell.cs')
  const executablePath = path.join(binPath, 'pwsh.exe')
  await fs.writeFile(
    sourcePath,
    `using System;
public static class FixtureShell {
  public static void Main() {
    Console.WriteLine("__OPENWAGGLE_ENV_PATH_START__");
    Console.WriteLine(Environment.GetEnvironmentVariable("PATH"));
    Console.WriteLine("__OPENWAGGLE_ENV_PATH_END__");
  }
}`,
  )
  const quotePath = (value: string) => `'${value.replaceAll("'", "''")}'`
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -Path ${quotePath(sourcePath)} -OutputAssembly ${quotePath(executablePath)} -OutputType ConsoleApplication`,
    ],
    { stdio: 'ignore' },
  )
  await fs.copyFile(executablePath, path.join(binPath, 'powershell.exe'))
  return environment
}

export async function assertFixtureCliEnvironment(app: OpenWaggleApp, binPath: string) {
  const effectivePath = await app.electronApplication().evaluate(() => process.env.PATH ?? '')
  expect(
    effectivePath.split(path.delimiter)[0],
    'Shell hydration must keep fake provider CLIs first, before any repository is opened',
  ).toBe(binPath)
}
