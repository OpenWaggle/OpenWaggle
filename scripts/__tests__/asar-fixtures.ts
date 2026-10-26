/** Builds a minimal Electron `app.asar` for the native platform-floor tests. */

interface DirectoryNode {
  files: { [name: string]: DirectoryNode | FileNode }
}

interface FileNode {
  size: number
  offset?: string
  unpacked?: true
}

function directoryAt(root: DirectoryNode, segments: readonly string[]) {
  let node = root
  for (const segment of segments) {
    const child = node.files[segment]
    if (child !== undefined && 'files' in child) {
      node = child
      continue
    }
    const created: DirectoryNode = { files: {} }
    node.files[segment] = created
    node = created
  }
  return node
}

/**
 * `files` maps archive paths (`node_modules/sharp/package.json`) to contents. Paths listed in
 * `unpacked` are recorded as unpacked; write their contents to `app.asar.unpacked` yourself.
 */
export function asarImage(files: Record<string, string>, unpacked: readonly string[] = []) {
  const root: DirectoryNode = { files: {} }
  const data: Buffer[] = []
  let offset = 0
  for (const [file, contents] of Object.entries(files)) {
    const segments = file.split('/')
    const name = segments.pop() ?? file
    const bytes = Buffer.from(contents)
    if (unpacked.includes(file)) {
      directoryAt(root, segments).files[name] = { size: bytes.length, unpacked: true }
      continue
    }
    directoryAt(root, segments).files[name] = { size: bytes.length, offset: String(offset) }
    data.push(bytes)
    offset += bytes.length
  }
  const json = Buffer.from(JSON.stringify(root))
  const padded = Math.ceil(json.length / 4) * 4
  const header = Buffer.alloc(16 + padded)
  header.writeUInt32LE(4, 0)
  header.writeUInt32LE(8 + padded, 4)
  header.writeUInt32LE(4 + padded, 8)
  header.writeUInt32LE(json.length, 12)
  json.copy(header, 16)
  return Buffer.concat([header, ...data])
}

export function packageJson(name: string, optionalDependencies: readonly string[] = []) {
  return JSON.stringify({
    name,
    optionalDependencies: Object.fromEntries(optionalDependencies.map((dependency) => [dependency, '1.0.0'])),
  })
}
