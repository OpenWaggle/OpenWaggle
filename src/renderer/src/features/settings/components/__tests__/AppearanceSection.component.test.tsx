import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { AppearanceSection } from '../sections/AppearanceSection'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSettings: vi.fn().mockResolvedValue(undefined),
    listSyntaxThemes: vi.fn().mockResolvedValue({ themes: [], languages: [], appearances: [] }),
  },
}))

describe('Appearance settings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
    })
  })

  it('shows the current diff view, wrap, and syntax theme selections', () => {
    render(<AppearanceSection />)

    // Defaults: unified, no wrap, default syntax theme.
    expect(screen.getByRole('button', { name: /Unified/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Side by side/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('switch', { name: /Wrap long lines/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('offers standard light, dark, and high-contrast appearance slots', () => {
    render(<AppearanceSection />)

    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'High Contrast Light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'High Contrast Dark' })).toBeInTheDocument()
  })

  it('writes the diff view straight to settings', () => {
    const setDiffView = vi.fn().mockResolvedValue(undefined)
    usePreferencesStore.setState({ setDiffView })

    render(<AppearanceSection />)
    fireEvent.click(screen.getByRole('button', { name: /Side by side/ }))

    expect(setDiffView).toHaveBeenCalledWith('split')
  })

  it('toggles line wrapping through settings rather than local state', () => {
    const setDiffWrapLines = vi.fn().mockResolvedValue(undefined)
    usePreferencesStore.setState({ setDiffWrapLines })

    render(<AppearanceSection />)
    fireEvent.click(screen.getByRole('switch', { name: /Wrap long lines/ }))

    expect(setDiffWrapLines).toHaveBeenCalledWith(true)
  })

  it('selects a syntax theme', () => {
    const setSyntaxTheme = vi.fn().mockResolvedValue(undefined)
    usePreferencesStore.setState({ setSyntaxTheme })

    render(<AppearanceSection />)
    fireEvent.click(screen.getByRole('button', { name: /One Dark Pro/ }))

    expect(setSyntaxTheme).toHaveBeenCalledWith('dark', 'bundled:one-dark-pro')
  })

  it('offers separate interface, document, code, and terminal typography roles', () => {
    render(<AppearanceSection />)

    expect(screen.getByRole('button', { name: 'Interface font: System UI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Documents font: System UI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Code font: System monospace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Terminal font: Following Code' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'Interface scale' })).toHaveValue('100')
    expect(screen.getByRole('spinbutton', { name: 'Code text' })).toHaveValue('12')
  })

  it('selects named font presets through a preview menu', () => {
    const setAppearanceTypography = vi.fn().mockResolvedValue(undefined)
    usePreferencesStore.setState({ setAppearanceTypography })

    render(<AppearanceSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Interface font: System UI' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Inter' }))

    expect(setAppearanceTypography).toHaveBeenCalledWith({
      interfaceFontFamily: 'Inter, system-ui, sans-serif',
    })
  })

  it('adjusts typography with compact number steppers', () => {
    const setAppearanceTypography = vi.fn().mockResolvedValue(undefined)
    usePreferencesStore.setState({ setAppearanceTypography })

    render(<AppearanceSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase Code text' }))

    expect(setAppearanceTypography).toHaveBeenCalledWith({
      codeFontSize: 13,
      codeLineHeight: 20,
    })
  })

  it('persists custom font-family stacks through appearance settings', () => {
    const setAppearanceTypography = vi.fn().mockResolvedValue(undefined)
    usePreferencesStore.setState({ setAppearanceTypography })

    render(<AppearanceSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Interface font: System UI' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Custom CSS stack…' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom Interface font family' }), {
      target: { value: 'Inter, system-ui, sans-serif' },
    })
    fireEvent.blur(screen.getByRole('textbox', { name: 'Custom Interface font family' }))

    expect(setAppearanceTypography).toHaveBeenCalledWith({
      interfaceFontFamily: 'Inter, system-ui, sans-serif',
    })
  })

  it('makes the syntax preview language explicit and switchable', () => {
    render(<AppearanceSection />)

    const language = screen.getByRole('combobox', { name: 'Preview language' })
    expect(language).toHaveValue('typescript')
    const typescriptPreview = screen.getByRole('region', {
      name: 'TypeScript syntax theme preview',
    })
    expect(within(typescriptPreview).getByText(/type WorkspaceTheme/)).toBeInTheDocument()

    fireEvent.change(language, { target: { value: 'python' } })

    const pythonPreview = screen.getByRole('region', { name: 'Python syntax theme preview' })
    expect(within(pythonPreview).getByText(/@dataclass/)).toBeInTheDocument()
  })

  it('lets the user reduce motion independently of the operating system', () => {
    const setAppearanceMotion = vi.fn().mockResolvedValue(undefined)
    usePreferencesStore.setState({ setAppearanceMotion })

    render(<AppearanceSection />)
    fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }))

    expect(setAppearanceMotion).toHaveBeenCalledWith('reduced')
  })
})
