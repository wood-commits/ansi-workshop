import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnsimationPanel } from './AnsimationPanel'
import { captureFrame } from './ansimation'
import { Editor } from './model'
import { chooseAnsiFile } from './open'
import { readAnsi } from './import'
import { chooseFile, writeChunks } from './save'

vi.mock('./open', () => ({ chooseAnsiFile: vi.fn() }))
vi.mock('./import', async importOriginal => {
  const actual = await importOriginal<typeof import('./import')>()
  return { ...actual, readAnsi: vi.fn() }
})
vi.mock('./save', () => ({ chooseFile: vi.fn(), writeChunks: vi.fn(), hasNativeSave: () => true }))
vi.mock('./Canvas', () => ({ drawGlyph: vi.fn() }))
const source = captureFrame(new Editor(new Map([['0,0', { code: 219, fg: 14, bg: 1 }]])).cells, 0)
let tick: FrameRequestCallback
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true }) },
    close: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false; this.dispatchEvent(new Event('close'))
    }) },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { tick = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.mocked(chooseAnsiFile).mockResolvedValue({ file: new File(['test'], 'second.ans') })
  vi.mocked(readAnsi).mockResolvedValue(new Map([['0,0', { code: 65, fg: 7, bg: 0 }]]))
  vi.mocked(chooseFile).mockResolvedValue(undefined)
  vi.mocked(writeChunks).mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals() })
const mount = () => render(<AnsimationPanel source={source} name="first.ans" top={0} onClose={vi.fn()} />)

describe('simple experimental ansimation UI', () => {
  it('offers fourteen effects, a fixed 80x25 frame, modem speeds and explicit export timing limitations', () => {
    mount()
    expect(screen.getByRole('dialog', { name: /Ansimation/ })).not.toBeNull()
    expect(screen.getByLabelText('Effect').querySelectorAll('option')).toHaveLength(14)
    expect(screen.queryByRole('option', { name: 'Tetrominos' })).toBeNull()
    expect(screen.getByLabelText('Preview speed').querySelectorAll('option')).toHaveLength(6)
    expect(screen.getByLabelText('Preview speed')).toHaveProperty('value', '14400')
    expect(screen.getByLabelText('Ansimation preview')).toHaveProperty('width', 640)
    expect(screen.getByLabelText('Ansimation preview')).toHaveProperty('height', 400)
    expect(screen.getByText(/no portable frame delays/)).not.toBeNull()
  })
  it('plays once at the selected speed, supports replay and stops on control changes', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Preview speed'), { target: { value: '56000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(screen.getByRole('button', { name: 'Stop' })).not.toBeNull()
    act(() => tick(0))
    act(() => tick(100))
    expect(screen.getByRole('status').textContent).toContain('Preview finished')
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    fireEvent.change(screen.getByLabelText('Effect'), { target: { value: 'flame' } })
    expect(screen.getByRole('button', { name: 'Play' })).not.toBeNull()
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })
  it('loads a second art without replacing the source, switches back to single art, and exports a separate copy', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Load second ANSI' }))
    await waitFor(() => expect(screen.getByText(/second.ans/)).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Export ANSI' }))
    await waitFor(() => expect(writeChunks).toHaveBeenCalledOnce())
    expect(chooseFile).toHaveBeenCalledWith('first-ansimation.ans')
    expect(vi.mocked(writeChunks).mock.calls[0][1]).toBeUndefined()
    expect(screen.getByRole('status').textContent).toContain('delivery cannot be verified')
    fireEvent.click(screen.getByRole('button', { name: 'Use single ANSI' }))
    expect(screen.queryByText(/second.ans/)).toBeNull()
    expect(source[0]).toEqual({ code: 219, fg: 14, bg: 1 })
  })
  it('shows cancellations and errors instead of claiming successful load or save', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mount()
    vi.mocked(chooseAnsiFile).mockRejectedValueOnce(new DOMException('Canceled', 'AbortError'))
    fireEvent.click(screen.getByRole('button', { name: 'Load second ANSI' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Load canceled'))
    vi.mocked(readAnsi).mockRejectedValueOnce(new Error('Unsupported control'))
    fireEvent.click(screen.getByRole('button', { name: 'Load second ANSI' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unsupported control'))
    vi.mocked(writeChunks).mockRejectedValueOnce(new Error('Disk full'))
    fireEvent.click(screen.getByRole('button', { name: 'Export ANSI' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Disk full'))
    expect(log).toHaveBeenCalledTimes(2)
  })
  it('cancels in-flight work before closing and ignores a late file picker result', async () => {
    let resolve: ((value: Awaited<ReturnType<typeof chooseAnsiFile>>) => void) | undefined
    vi.mocked(chooseAnsiFile).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const close = vi.fn()
    render(<AnsimationPanel source={source} name="first.ans" top={0} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load second ANSI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close ansimation' }))
    expect(close).toHaveBeenCalledOnce()
    await act(async () => resolve!({ file: new File(['test'], 'late.ans') }))
    expect(readAnsi).not.toHaveBeenCalled()
  })
  it('uses only the current art for text effects, explains empty text and restores the retained second art', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Load second ANSI' }))
    await waitFor(() => expect(screen.getByText(/second.ans/)).not.toBeNull())
    fireEvent.change(screen.getByLabelText('Effect'), { target: { value: 'text-spinner' } })
    expect(screen.queryByLabelText('Frame detail')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replace second ANSI' })).toBeNull()
    expect(screen.getByText(/No ASCII letters or digits/)).not.toBeNull()
    expect(screen.getByText(/second ANSI is retained/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Export ANSI' }))
    await waitFor(() => expect(writeChunks).toHaveBeenCalledOnce())
    const chunks = [...vi.mocked(writeChunks).mock.calls[0][0]]
    expect(chunks).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Effect'), { target: { value: 'neo' } })
    expect(screen.getByText(/Transition: first.ans → second.ans/)).not.toBeNull()
    expect(screen.getByLabelText('Frame detail')).not.toBeNull()
  })
  it('keeps bullet-hole bursts automatic and permits single- and two-art export', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Effect'), { target: { value: 'bullet-holes' } })
    expect(screen.queryByLabelText('Frame detail')).toBeNull()
    expect(screen.getByText(/61 frames generated automatically.*debris clears/)).not.toBeNull()
    expect(screen.getByText(/Single ANSI: art → blank/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load second ANSI' }))
    await waitFor(() => expect(screen.getByText(/Transition: first.ans → second.ans/)).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Export ANSI' }))
    await waitFor(() => expect(writeChunks).toHaveBeenCalledOnce())
    expect([...vi.mocked(writeChunks).mock.calls[0][0]]).toHaveLength(63)
    fireEvent.change(screen.getByLabelText('Effect'), { target: { value: 'wipe' } })
    expect(screen.getByLabelText('Frame detail')).not.toBeNull()
  })
})
