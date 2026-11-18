/**
 * A desktop shell port's contract: what every shell adapter of the port must do, as named cases
 * over a harness the shell's runner builds afresh for each case. Runners turn each case into one
 * test (`src/main/adapters/electron/__tests__/contracts/`).
 */
export interface PortContract<Harness> {
  readonly port: string
  readonly cases: Readonly<Record<string, (harness: Harness) => void | Promise<void>>>
}

export function definePortContract<Harness>(port: string, cases: PortContract<Harness>['cases']) {
  return { port, cases }
}
