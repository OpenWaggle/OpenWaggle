import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import * as ts from 'typescript'

const ROOT = process.cwd()

const INCLUDE_ROOTS = ['src', 'scripts']
const ROOT_LEVEL_FILES = ['electron.vite.config.ts', 'playwright.config.ts']

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'test-results',
  'tasks',
  'docs',
])

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const NEGATIVE_ONE_LITERAL = '-1'
const NEGATIVE_ZERO_LITERAL = '-0'
const ONE_LITERAL = '1'
const ZERO_LITERAL = '0'
const MAX_REPORTED_FINDINGS = 200
const DISALLOWED_EXTRACTION_COMMENT = 'Extracted from inlined numeric' + ' literal'

function isTestFile(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/')

  return (
    normalizedPath.includes('/__tests__/') ||
    normalizedPath.includes('/test/') ||
    normalizedPath.includes('/tests/') ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalizedPath)
  )
}

function getScriptKind(filePath) {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

async function collectCodeFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue
    }

    const fullPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectCodeFiles(fullPath)))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (!CODE_EXTENSIONS.has(path.extname(entry.name))) {
      continue
    }

    if (entry.name.endsWith('.d.ts')) {
      continue
    }

    if (isTestFile(fullPath)) {
      continue
    }

    files.push(fullPath)
  }

  return files
}

function isInTypePosition(node) {
  let current = node.parent
  while (current) {
    if (ts.isTypeNode(current) || ts.isTypeQueryNode(current)) {
      return true
    }
    current = current.parent
  }
  return false
}

function isInEnumDeclaration(node) {
  let current = node.parent
  while (current) {
    if (ts.isEnumDeclaration(current)) {
      return true
    }
    current = current.parent
  }
  return false
}

function isWithinNamedConstantInitializer(node) {
  let current = node
  while (current.parent) {
    if (ts.isVariableDeclaration(current.parent) && current.parent.initializer === current) {
      const declarationList = current.parent.parent
      if (!ts.isVariableDeclarationList(declarationList)) {
        return false
      }
      if ((declarationList.flags & ts.NodeFlags.Const) === 0) {
        return false
      }
      if (!ts.isIdentifier(current.parent.name)) {
        return false
      }
      return isScreamingSnakeCase(current.parent.name.text)
    }
    current = current.parent
  }
  return false
}

function isScreamingSnakeCase(name) {
  return /^[A-Z][A-Z0-9_]*$/.test(name)
}

function isCandidateNumericExpression(node) {
  if (ts.isNumericLiteral(node)) {
    if (ts.isPrefixUnaryExpression(node.parent) && node.parent.operand === node) {
      return false
    }
    return true
  }

  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return true
  }

  return false
}

function walk(node, visitor) {
  visitor(node)
  ts.forEachChild(node, (child) => walk(child, visitor))
}

function shouldIgnoreLiteralValue(literalText) {
  return (
    literalText === ZERO_LITERAL ||
    literalText === ONE_LITERAL ||
    literalText === NEGATIVE_ZERO_LITERAL ||
    literalText === NEGATIVE_ONE_LITERAL
  )
}

function toRelative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/')
}

async function collectTargetFiles() {
  const files = []

  for (const includeRoot of INCLUDE_ROOTS) {
    const fullPath = path.join(ROOT, includeRoot)

    try {
      const stats = await fs.stat(fullPath)
      if (stats.isDirectory()) {
        files.push(...(await collectCodeFiles(fullPath)))
      }
    } catch {
      // Optional include root.
    }
  }

  for (const rootFile of ROOT_LEVEL_FILES) {
    const fullPath = path.join(ROOT, rootFile)

    try {
      const stats = await fs.stat(fullPath)
      if (stats.isFile()) {
        files.push(fullPath)
      }
    } catch {
      // Optional root file.
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

async function main() {
  const targetFiles = await collectTargetFiles()
  const inlineFindings = []
  const commentFindings = []

  for (const filePath of targetFiles) {
    const sourceText = await fs.readFile(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(filePath),
    )

    walk(sourceFile, (node) => {
      if (!isCandidateNumericExpression(node)) {
        return
      }

      if (isInTypePosition(node)) {
        return
      }

      if (isInEnumDeclaration(node)) {
        return
      }

      if (isWithinNamedConstantInitializer(node)) {
        return
      }

      const literalText = sourceText.slice(node.getStart(sourceFile), node.getEnd())
      if (shouldIgnoreLiteralValue(literalText)) {
        return
      }

      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      inlineFindings.push(
        `${toRelative(filePath)}:${position.line + 1}:${position.character + 1} inline numeric literal ${literalText}`,
      )
    })

    if (sourceText.includes(DISALLOWED_EXTRACTION_COMMENT)) {
      let searchIndex = 0
      while (searchIndex < sourceText.length) {
        const foundIndex = sourceText.indexOf(DISALLOWED_EXTRACTION_COMMENT, searchIndex)
        if (foundIndex === -1) break
        const position = sourceFile.getLineAndCharacterOfPosition(foundIndex)
        commentFindings.push(
          `${toRelative(filePath)}:${position.line + 1}:${position.character + 1} remove auto-generated extraction comment`,
        )
        searchIndex = foundIndex + DISALLOWED_EXTRACTION_COMMENT.length
      }
    }
  }

  let hasErrors = false

  if (inlineFindings.length > 0) {
    hasErrors = true
    console.error(
      `check-magic-numbers: found ${inlineFindings.length} inline magic number${
        inlineFindings.length === 1 ? '' : 's'
      }`,
    )

    for (const finding of inlineFindings.slice(0, MAX_REPORTED_FINDINGS)) {
      console.error(`- ${finding}`)
    }

    if (inlineFindings.length > MAX_REPORTED_FINDINGS) {
      console.error(
        `- ... and ${inlineFindings.length - MAX_REPORTED_FINDINGS} more finding${
          inlineFindings.length - MAX_REPORTED_FINDINGS === 1 ? '' : 's'
        }`,
      )
    }
  }

  if (commentFindings.length > 0) {
    hasErrors = true
    console.error(
      `check-magic-numbers: found ${commentFindings.length} disallowed extraction comment${
        commentFindings.length === 1 ? '' : 's'
      }`,
    )
    for (const finding of commentFindings.slice(0, MAX_REPORTED_FINDINGS)) {
      console.error(`- ${finding}`)
    }
  }

  if (hasErrors) {
    process.exit(1)
  }

  console.log('check-magic-numbers: no inline magic numbers found')
}

void main()
