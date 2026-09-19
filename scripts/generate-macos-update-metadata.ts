import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const INPUT_DIRECTORY_ARGUMENT_INDEX = 2
const VERSION_ARGUMENT_INDEX = 3
const UPDATE_METADATA_FILE = 'latest-mac.yml'
const MAC_ARCHITECTURES = ['arm64', 'x64'] as const
const MAC_ARTIFACT_EXTENSIONS = ['zip', 'dmg'] as const

interface UpdateFile {
  readonly url: string
  readonly sha512: string
  readonly size: number
}

async function updateFile(directory: string, filename: string): Promise<UpdateFile> {
  const filePath = path.join(directory, filename)
  const [contents, stats] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)])
  return {
    url: filename,
    sha512: createHash('sha512').update(contents).digest('base64'),
    size: stats.size,
  }
}

function yamlString(value: string) {
  return JSON.stringify(value)
}

export async function generateMacosUpdateMetadata(input: {
  readonly directory: string
  readonly version: string
  readonly releaseDate?: string
}) {
  const expectedNames = MAC_ARCHITECTURES.flatMap((architecture) =>
    MAC_ARTIFACT_EXTENSIONS.map(
      (extension) => `openwaggle-${input.version}-${architecture}.${extension}`,
    ),
  )
  const files = await Promise.all(expectedNames.map((name) => updateFile(input.directory, name)))
  const primary = files.find((file) => file.url.endsWith('-x64.zip'))
  if (primary === undefined) throw new Error('macOS update metadata omitted the x64 ZIP.')

  const lines = [yamlString(input.version).replace(/^/u, 'version: '), 'files:']
  for (const file of files) {
    lines.push(
      `  - url: ${yamlString(file.url)}`,
      `    sha512: ${yamlString(file.sha512)}`,
      `    size: ${String(file.size)}`,
    )
  }
  lines.push(
    `path: ${yamlString(primary.url)}`,
    `sha512: ${yamlString(primary.sha512)}`,
    `releaseDate: ${yamlString(input.releaseDate ?? new Date().toISOString())}`,
    '',
  )
  await fs.writeFile(path.join(input.directory, UPDATE_METADATA_FILE), lines.join('\n'))
}

async function main() {
  const directory = process.argv[INPUT_DIRECTORY_ARGUMENT_INDEX]
  const version = process.argv[VERSION_ARGUMENT_INDEX]
  if (directory === undefined || version === undefined) {
    throw new Error('Usage: generate-macos-update-metadata.ts <artifact-directory> <version>')
  }
  await generateMacosUpdateMetadata({ directory: path.resolve(directory), version })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
