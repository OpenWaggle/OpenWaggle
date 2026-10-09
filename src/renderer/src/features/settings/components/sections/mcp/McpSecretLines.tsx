/**
 * What a saved server reads from the vault: the secrets to add before using it, and those that
 * already exist and would be shared. `subject` is "one" for a Registry install, "many" for an
 * import that may have saved several servers.
 */
export function McpSecretLines({
  secrets,
  existingSecrets,
  subject,
}: {
  readonly secrets: readonly string[]
  readonly existingSecrets: readonly string[]
  readonly subject: 'one' | 'many'
}) {
  const stored = new Set(existingSecrets)
  const missing = secrets.filter((secret) => !stored.has(secret))
  const one = subject === 'one'
  return (
    <>
      {missing.length > 0 ? (
        <p className="text-warning">
          {one ? 'It reads' : 'The imported servers read'} the secret
          {missing.length === 1 ? '' : 's'} {missing.join(', ')}. Add{' '}
          {missing.length === 1 ? 'it' : 'them'} under Secrets before using{' '}
          {one ? 'the server' : 'them'}.
        </p>
      ) : null}
      {existingSecrets.length > 0 ? (
        <p>
          {one ? 'It uses' : 'They use'} the secret{existingSecrets.length === 1 ? '' : 's'}{' '}
          {existingSecrets.join(', ')}, which already{' '}
          {existingSecrets.length === 1 ? 'exists' : 'exist'} under Secrets; replace{' '}
          {existingSecrets.length === 1 ? 'it' : 'them'} there if{' '}
          {existingSecrets.length === 1 ? 'it holds' : 'they hold'} another value.
        </p>
      ) : null}
    </>
  )
}
