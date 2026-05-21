import type { Rule } from 'eslint'
import { normalizedFilename } from '../ast-helpers'

const TEST_FILE_PATTERN = /\.(unit|integration|component)?\.?test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/
const FILE_START_LOCATION = {
  line: 1,
  column: 0,
}

function isSourceTestFile(filename: string) {
  const normalized = normalizedFilename(filename)
  return (normalized.startsWith('src/') || normalized.includes('/src/')) && TEST_FILE_PATTERN.test(normalized)
}

export const testColocationRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      testColocation:
        'Source tests must live under a local __tests__ directory so related production code and tests stay discoverable together.',
    },
  },
  create(context) {
    return {
      Program() {
        const normalized = normalizedFilename(context.filename)
        if (!isSourceTestFile(normalized) || normalized.includes('/__tests__/')) {
          return
        }

        context.report({
          loc: FILE_START_LOCATION,
          messageId: 'testColocation',
        })
      },
    }
  },
}
