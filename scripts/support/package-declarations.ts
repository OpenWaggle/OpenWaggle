/**
 * The declaration graph of a built package: the `.d.ts` files its `exports` reach, read through
 * their relative imports. The API snapshot renders it, and `prune-package-declarations.ts`
 * deletes the declarations nothing reaches.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast'
import { Schema } from '@shared/schema'
import { objectEntries, objectFields, unknownField } from './object-fields'

interface PackageJson {
  /** The `exports` map's entries: each subpath and its target, checked where it is read. */
  readonly exports?: readonly (readonly [string, unknown])[]
  readonly name: string
}

export interface TypedExport {
  readonly declarationPath?: string
  readonly subpath: string
}

export interface DeclarationBlock {
  readonly contents: string
  readonly relativePath: string
}

const namedPackageJsonSchema = Schema.Struct({ name: Schema.String, exports: unknownField })
const typedExportTargetSchema = Schema.Struct({ types: Schema.String })

function toPackageJson(value: unknown, packageJsonPath: string) {
  const manifest = objectFields(namedPackageJsonSchema, value)
  if (manifest === undefined) {
    throw new Error(`${packageJsonPath} must contain a package name.`)
  }
  const exportsValue = objectEntries(manifest.exports)
  const packageJson: PackageJson = {
    ...(exportsValue === undefined ? {} : { exports: exportsValue }),
    name: manifest.name,
  }
  return packageJson
}

export async function readPackageJson(packageRoot: string) {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  const parsed: unknown = JSON.parse(await readFile(packageJsonPath, 'utf8'))

  return toPackageJson(parsed, packageJsonPath)
}

export function normalizeRelativePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function normalizeExportTargetPath(targetPath: string) {
  return targetPath.replace(/^\.\//, '')
}

function declarationPathForExportTarget(target: unknown) {
  const typedTarget = objectFields(typedExportTargetSchema, target)
  return typedTarget === undefined ? undefined : normalizeExportTargetPath(typedTarget.types)
}

export function listTypedExports(packageJson: PackageJson) {
  const exportsValue = packageJson.exports
  if (!exportsValue) {
    return []
  }

  return exportsValue.map(([subpath, target]) => {
    const declarationPath = declarationPathForExportTarget(target)
    return { ...(declarationPath === undefined ? {} : { declarationPath }), subpath }
  }) satisfies readonly TypedExport[]
}

function normalizeDeclarationContents(contents: string) {
  return contents.replace(/\r\n/g, '\n').trimEnd()
}

function declarationPathForModuleSpecifier(moduleSpecifier: string) {
  if (!moduleSpecifier.startsWith('.')) {
    return undefined
  }

  if (moduleSpecifier.endsWith('.js')) {
    return `${moduleSpecifier.slice(0, -'.js'.length)}.d.ts`
  }

  if (moduleSpecifier.endsWith('.d.ts')) {
    return moduleSpecifier
  }

  return `${moduleSpecifier}.d.ts`
}

/** Every module specifier a declaration file imports or re-exports. */
function moduleSpecifiers(contents: string) {
  const specifiers: string[] = []
  const scanner = createScanner(true, LanguageVariant.Standard, contents)
  let previousToken: SyntaxKind | null = null
  let tokenBeforePrevious: SyntaxKind | null = null
  let token = scanner.scan()

  while (token !== SyntaxKind.EndOfFile) {
    const followsFrom = previousToken === SyntaxKind.FromKeyword
    const followsBareImport = previousToken === SyntaxKind.ImportKeyword
    const followsImportCall =
      previousToken === SyntaxKind.OpenParenToken &&
      tokenBeforePrevious === SyntaxKind.ImportKeyword

    if (
      token === SyntaxKind.StringLiteral &&
      (followsFrom || followsBareImport || followsImportCall)
    ) {
      specifiers.push(scanner.getTokenValue())
    }

    tokenBeforePrevious = previousToken
    previousToken = token
    token = scanner.scan()
  }

  return specifiers
}

export function relativeDeclarationDependencies(contents: string) {
  return moduleSpecifiers(contents).flatMap((specifier) => {
    const declarationPath = declarationPathForModuleSpecifier(specifier)
    return declarationPath === undefined ? [] : [declarationPath]
  })
}

/** The Effect modules (`effect`, `effect/Schema`, ...) a declaration file names. */
export function effectModuleSpecifiers(contents: string) {
  return moduleSpecifiers(contents).filter(
    (specifier) => specifier === 'effect' || specifier.startsWith('effect/'),
  )
}

export async function collectDeclarationBlocks(packageRoot: string, declarationPath: string) {
  const blocks: DeclarationBlock[] = []
  const visited = new Set<string>()

  async function visit(currentDeclarationPath: string) {
    const absolutePath = path.join(packageRoot, currentDeclarationPath)
    if (visited.has(absolutePath)) {
      return
    }
    visited.add(absolutePath)

    const contents = normalizeDeclarationContents(await readFile(absolutePath, 'utf8'))
    blocks.push({
      contents,
      relativePath: normalizeRelativePath(path.relative(packageRoot, absolutePath)),
    })

    for (const childDeclarationPath of relativeDeclarationDependencies(contents)) {
      await visit(
        path.normalize(path.join(path.dirname(currentDeclarationPath), childDeclarationPath)),
      )
    }
  }

  await visit(declarationPath)

  return blocks
}

/** Every declaration file the package's typed exports reach, relative to the package root. */
export async function reachableDeclarationFiles(packageRoot: string) {
  const packageJson = await readPackageJson(packageRoot)
  const reachable = new Set<string>()
  for (const { declarationPath } of listTypedExports(packageJson)) {
    if (declarationPath === undefined) continue
    for (const block of await collectDeclarationBlocks(packageRoot, declarationPath)) {
      reachable.add(block.relativePath)
    }
  }
  return reachable
}

/** Every `.d.ts` file under the package's `dist`, relative to the package root. */
export async function builtDeclarationFiles(packageRoot: string) {
  const files = await readdir(path.join(packageRoot, 'dist'), { recursive: true })
  return files
    .filter((file) => file.endsWith('.d.ts'))
    .map((file) => normalizeRelativePath(path.join('dist', file)))
    .toSorted()
}
