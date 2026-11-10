/**
 * Plugs the Fallow and React Doctor checks (scripts/agent-quality-gates, GATE-02 and REACT-07)
 * into the agent gate, so one gate gives one verdict and one loop guard covers every finding.
 */
import { qualityGateFindings } from '../agent-quality-gates/gates'
import type { Finding as QualityFinding } from '../agent-quality-gates/findings'
import type { Finding } from './findings'
import type { GatePlugin } from './gate'

export function qualityFinding(finding: QualityFinding): Finding {
  return {
    file: finding.file,
    ...(finding.line === undefined ? {} : { line: finding.line }),
    rule: `${finding.tool.replace(' ', '/')}/${finding.rule}`,
    id: finding.tool === 'react-doctor' ? 'REACT-07' : 'GATE-02',
    message: finding.message,
    severity: 'block',
  }
}

export const qualityGatesPlugin: GatePlugin = {
  name: 'fallow and react-doctor',
  async run(input) {
    const findings = await qualityGateFindings(input)
    return { findings: findings.map(qualityFinding), failures: [] }
  },
}
