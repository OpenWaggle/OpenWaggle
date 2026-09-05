function repositoryUrl(remoteUrl: string) {
  try {
    return new URL(remoteUrl)
  } catch {
    return null
  }
}

export function repositoryWebUrl(remoteUrl: string) {
  const url = repositoryUrl(remoteUrl)
  if (url) {
    const repositoryPath = url.pathname.replace(/^\/+|\.git$/gu, '')
    const webHost = url.protocol === 'http:' || url.protocol === 'https:' ? url.host : url.hostname
    return repositoryPath ? `https://${webHost}/${repositoryPath}` : null
  }

  const scp = /^(?:[^@/\s]+@)?(?<host>[^:/\s]+):(?<path>[^/].+)$/u.exec(remoteUrl)
  if (!scp?.groups?.host || !scp.groups.path) return null
  return `https://${scp.groups.host}/${scp.groups.path.replace(/\.git$/u, '')}`
}
