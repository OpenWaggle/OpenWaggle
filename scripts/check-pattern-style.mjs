import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import * as ts from 'typescript'

const ROOT = process.cwd()
const SRC_DIR = path.join(ROOT, 'src')

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

async function collectSourceFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)))
      continue
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

function walk(node, visit) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

function toRelative(filePath) {
  return path.relative(ROOT, filePath)
}

async function main() {
  const files = await collectSourceFiles(SRC_DIR)
  const violations = []

  for (const filePath of files) {
    const text = await fs.readFile(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)

    walk(sourceFile, (node) => {
      if (ts.isSwitchStatement(node)) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart())
        violations.push({
          file: toRelative(filePath),
          line: pos.line + 1,
          reason: 'switch statements are disallowed; use choose/chooseBy',
        })
      }

      if (ts.isIfStatement(node) && node.elseStatement && ts.isIfStatement(node.elseStatement)) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.elseStatement.getStart())
        violations.push({
          file: toRelative(filePath),
          line: pos.line + 1,
          reason: 'else-if chains are disallowed; use choose/chooseBy or guard clauses',
        })
      }
    })
  }

  if (violations.length === 0) {
    console.log('check-pattern-style: no disallowed branching patterns found')
    return
  }

  console.error('check-pattern-style: disallowed branching patterns found:')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.reason}`)
  }
  process.exit(1)
}

void main()
