import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TundraColors } from './TundraColors'
import { rgbColor } from './colors'
import type { Cell } from './model'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('RGB swatches bounds', () => {
  it('paginates used colors and updates them after art changes', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells = new Map<string, Cell>(Array.from({ length: 100 }, (_, i) =>
      [`${i % 80},${Math.floor(i / 80)}`, { code: 219, fg: rgbColor(`#1234${i.toString(16).padStart(2, '0')}`), bg: 0 }]))
    const props = { fg: 7, bg: 0, code: 219, font: 'ibm-vga' as const, cells,
      onFg: vi.fn(), onBg: vi.fn(), onError: vi.fn() }
    const { rerender } = render(<TundraColors {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Currently Used (101)' }))
    expect(screen.getAllByRole('button', { name: /^Swatch #/ })).toHaveLength(64)
    fireEvent.click(screen.getByRole('button', { name: 'Next colors' }))
    expect(screen.getAllByRole('button', { name: /^Swatch #/ })).toHaveLength(37)
    fireEvent.focus(screen.getAllByRole('button', { name: /^Swatch #/ })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Background #/ }))
    expect(props.onBg).toHaveBeenCalledOnce()
    rerender(<TundraColors {...props} cells={new Map()} />)
    expect(screen.getByRole('tab', { name: 'Currently Used (0)' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Next colors' })).toBeNull()
  })

  it('limits saved swatches to 64, permits renaming and frees removed entries', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const props = { fg: 7, bg: 0, code: 219, font: 'ibm-vga' as const, cells: new Map<string, Cell>(),
      onFg: vi.fn(), onBg: vi.fn(), onError: vi.fn() }
    const { rerender } = render(<TundraColors {...props} />)
    for (let i = 0; i < 64; i++) {
      rerender(<TundraColors {...props} fg={rgbColor(`#1234${i.toString(16).padStart(2, '0')}`)} />)
      fireEvent.click(screen.getByRole('button', { name: 'Save FG swatch' }))
    }
    expect(screen.getAllByRole('button', { name: /^Swatch #/ })).toHaveLength(64)
    rerender(<TundraColors {...props} fg={rgbColor('#abcdef')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save FG swatch' }))
    expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('64 saved colors') }))
    rerender(<TundraColors {...props} fg={rgbColor('#123400')} />)
    fireEvent.change(screen.getByLabelText('Swatch name'), { target: { value: '<script>not HTML</script>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save FG swatch' }))
    fireEvent.focus(screen.getByRole('button', { name: 'Swatch <script>not HTML</script>' }))
    expect(screen.getByText('<script>not HTML</script>')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: /^Swatch / })).toHaveLength(64)
    fireEvent.click(screen.getByRole('button', { name: 'Remove swatch <script>not HTML</script>' }))
    rerender(<TundraColors {...props} fg={rgbColor('#abcdef')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save FG swatch' }))
    expect(screen.getAllByRole('button', { name: /^Swatch #/ })).toHaveLength(64)
  })

  it('shows hover/focus actions without adding rows and supports keyboard-accessible tabs', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const color = rgbColor('#123456')
    const props = { fg: color, bg: 0, code: 219, font: 'ibm-vga' as const,
      cells: new Map([['0,0', { code: 219, fg: color, bg: 0 }]]),
      onFg: vi.fn(), onBg: vi.fn(), onError: vi.fn() }
    render(<TundraColors {...props} />)
    fireEvent.change(screen.getByLabelText('Swatch name'), { target: { value: 'Ocean' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save FG swatch' }))
    const swatch = screen.getByRole('button', { name: 'Swatch Ocean' })
    expect(screen.queryByRole('button', { name: 'Foreground Ocean' })).toBeNull()
    fireEvent.mouseEnter(swatch)
    expect(screen.getByText('Ocean')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Background Ocean' }))
    expect(props.onBg).toHaveBeenCalledWith(color)
    fireEvent.mouseLeave(swatch.parentElement!)
    expect(screen.queryByRole('button', { name: 'Foreground Ocean' })).toBeNull()
    fireEvent.focus(swatch)
    fireEvent.click(screen.getByRole('button', { name: 'Foreground Ocean' }))
    expect(props.onFg).toHaveBeenCalledWith(color)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'User Defined' }), { key: 'ArrowRight' })
    const used = screen.getByRole('tab', { name: 'Currently Used (2)' })
    expect(used.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(used)
    expect(screen.queryByLabelText('Swatch name')).toBeNull()
    fireEvent.keyDown(used, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'User Defined' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'Swatch Ocean' })).not.toBeNull()
  })
})
