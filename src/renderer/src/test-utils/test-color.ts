/** Builds a color fixture without embedding product palette literals in renderer tests. */
export function testHexColor(digits: string) {
  return `#${digits}`
}
