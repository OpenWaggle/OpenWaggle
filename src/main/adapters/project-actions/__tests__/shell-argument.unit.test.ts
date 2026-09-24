import { execFileSync } from 'node:child_process'
import { parseJsonUnknown } from '@shared/schema'
import { quotePosixShellArgument } from '@shared/utils/shell-argument'
import { expect, it } from 'vitest'

it.skipIf(process.platform === 'win32')(
  'round trips argument boundaries and shell metacharacters without executing them',
  () => {
    const args = [
      '',
      'test unit',
      "single'quote",
      'semi;colon',
      '$(printf injected)',
      '`printf injected`',
      'line\nbreak',
      'glob*',
    ]
    const command = [
      process.execPath,
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      ...args,
    ]
      .map(quotePosixShellArgument)
      .join(' ')
    expect(
      parseJsonUnknown(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })),
    ).toEqual(args)
  },
)
