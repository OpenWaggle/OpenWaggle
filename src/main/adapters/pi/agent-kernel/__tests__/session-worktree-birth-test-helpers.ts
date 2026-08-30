export function unrelatedWorktreeGitResult(cwd: string, args: readonly string[]) {
  if (args[0] === 'rev-parse' && args.includes('--git-common-dir')) {
    return Promise.resolve({
      code: 0,
      stdout: cwd === '/repo' ? '/repo/.git\n' : '/elsewhere/.git\n',
      stderr: '',
    })
  }
  return Promise.resolve({ code: 0, stdout: 'main\n', stderr: '' })
}
