const LANGUAGE_ASSOCIATIONS_PREFIX = 'openwaggle:language-associations:v2:'

interface WorkspaceLanguageAssociations {
  readonly exact: Readonly<Record<string, string>>
  readonly extensions: Readonly<Record<string, string>>
  readonly fileNames: Readonly<Record<string, string>>
}

const EMPTY_ASSOCIATIONS: WorkspaceLanguageAssociations = {
  exact: {},
  extensions: {},
  fileNames: {},
}

function storageKey(projectIdentity: string) {
  return `${LANGUAGE_ASSOCIATIONS_PREFIX}${encodeURIComponent(projectIdentity)}`
}

function stringRecord(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function readAssociations(
  storage: Storage,
  projectIdentity: string,
): WorkspaceLanguageAssociations {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey(projectIdentity)) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return EMPTY_ASSOCIATIONS
    }
    const record = parsed as Readonly<Record<string, unknown>>
    return {
      exact: stringRecord(record.exact),
      extensions: stringRecord(record.extensions),
      fileNames: stringRecord(record.fileNames),
    }
  } catch {
    return EMPTY_ASSOCIATIONS
  }
}

function writeAssociations(
  storage: Storage,
  projectIdentity: string,
  associations: WorkspaceLanguageAssociations,
) {
  if (
    Object.keys(associations.exact).length === 0 &&
    Object.keys(associations.extensions).length === 0 &&
    Object.keys(associations.fileNames).length === 0
  ) {
    storage.removeItem(storageKey(projectIdentity))
    return
  }
  storage.setItem(storageKey(projectIdentity), JSON.stringify(associations))
}

function pathAssociation(filePath: string) {
  const basename = filePath.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? ''
  const dot = basename.lastIndexOf('.')
  return { basename, extension: dot > 0 ? basename.slice(dot) : null }
}

export function workspaceLanguageAssociation(
  storage: Storage,
  projectIdentity: string,
  filePath: string,
) {
  const associations = readAssociations(storage, projectIdentity)
  const { basename, extension } = pathAssociation(filePath)
  return (
    associations.exact[filePath] ??
    associations.fileNames[basename] ??
    (extension ? associations.extensions[extension] : undefined) ??
    null
  )
}

export function setWorkspaceLanguageAssociation(
  storage: Storage,
  projectIdentity: string,
  filePath: string,
  language: string,
) {
  const current = readAssociations(storage, projectIdentity)
  writeAssociations(storage, projectIdentity, {
    exact: { ...current.exact, [filePath]: language },
    extensions: current.extensions,
    fileNames: current.fileNames,
  })
}

export function setWorkspaceLanguagePatternAssociation(
  storage: Storage,
  projectIdentity: string,
  filePath: string,
  language: string,
) {
  const current = readAssociations(storage, projectIdentity)
  const { basename, extension } = pathAssociation(filePath)
  writeAssociations(storage, projectIdentity, {
    ...current,
    extensions: extension ? { ...current.extensions, [extension]: language } : current.extensions,
    fileNames: extension ? current.fileNames : { ...current.fileNames, [basename]: language },
  })
}

export function workspaceLanguagePatternLabel(filePath: string) {
  const { basename, extension } = pathAssociation(filePath)
  return extension ? `*${extension}` : basename
}

export function retargetWorkspaceLanguageAssociations(
  storage: Storage,
  projectIdentity: string,
  previousPath: string,
  nextPath: string,
) {
  const current = readAssociations(storage, projectIdentity)
  const exact: Record<string, string> = {}
  for (const [filePath, language] of Object.entries(current.exact)) {
    const targetPath =
      filePath === previousPath || filePath.startsWith(`${previousPath}/`)
        ? `${nextPath}${filePath.slice(previousPath.length)}`
        : filePath
    exact[targetPath] = language
  }
  writeAssociations(storage, projectIdentity, { ...current, exact })
}

export function removeWorkspaceLanguageAssociations(
  storage: Storage,
  projectIdentity: string,
  entryPath: string,
) {
  const current = readAssociations(storage, projectIdentity)
  const exact = Object.fromEntries(
    Object.entries(current.exact).filter(
      ([candidate]) => candidate !== entryPath && !candidate.startsWith(`${entryPath}/`),
    ),
  )
  writeAssociations(storage, projectIdentity, { ...current, exact })
}
