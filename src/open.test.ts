import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseAnsiFile } from './open'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('browser-authorized file opening', () => {
  it('offers TundraDraw alongside ANSI only when requested', async () => {
    const file = new File(['test'], 'screen.tnd')
    const handle = { name: file.name, getFile: vi.fn().mockResolvedValue(file), createWritable: vi.fn() }
    const picker = vi.fn().mockResolvedValue([handle])
    vi.stubGlobal('showOpenFilePicker', picker)
    expect(await chooseAnsiFile(true)).toEqual({ file, handle })
    expect(picker).toHaveBeenCalledWith({
      multiple: false,
      types: [{ description: 'ANSI / TundraDraw art (CP437)', accept: { 'application/octet-stream': ['.ans', '.tnd'] } }],
    })
  })
  it('uses the native single-file picker and retains only its authorized handle', async () => {
    const file = new File(['A'], 'saved.ans')
    const handle = { name: file.name, getFile: vi.fn().mockResolvedValue(file), createWritable: vi.fn() }
    const picker = vi.fn().mockResolvedValue([handle])
    vi.stubGlobal('showOpenFilePicker', picker)
    expect(await chooseAnsiFile()).toEqual({ file, handle })
    expect(picker).toHaveBeenCalledWith({
      multiple: false,
      types: [{ description: 'ANSI art (CP437)', accept: { 'application/octet-stream': ['.ans'] } }],
    })
    expect(handle.createWritable).not.toHaveBeenCalled()
  })

  it('propagates native cancellation and read errors without silently falling back', async () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockRejectedValue(new DOMException('Canceled', 'AbortError')))
    await expect(chooseAnsiFile()).rejects.toHaveProperty('name', 'AbortError')
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([{
      name: 'saved.ans', getFile: vi.fn().mockRejectedValue(new Error('Read denied')), createWritable: vi.fn(),
    }]))
    await expect(chooseAnsiFile()).rejects.toThrow('Read denied')
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('rejects an empty native picker result explicitly', async () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([]))
    await expect(chooseAnsiFile()).rejects.toThrow('No ANSI file')
  })

  it('opens a file input fallback without a writable handle and cleans it up', async () => {
    vi.stubGlobal('showOpenFilePicker', undefined)
    const file = new File(['A'], 'fallback.ans')
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      expect(this.accept).toBe('.ans')
      expect(this.multiple).toBe(false)
      Object.defineProperty(this, 'files', { value: [file] })
      this.dispatchEvent(new Event('change'))
    })
    expect(await chooseAnsiFile()).toEqual({ file })
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('uses a read-only file input in Electron instead of exposed native pickers', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Code/1.144.0 Chrome/150.0.0.0 Electron/43.8.3 Safari/537.36')
    const picker = vi.fn()
    vi.stubGlobal('showOpenFilePicker', picker)
    const file = new File([new Uint8Array([219])], 'screen.ans')
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [file] })
      this.dispatchEvent(new Event('change'))
    })
    expect(await chooseAnsiFile()).toEqual({ file })
    expect(picker).not.toHaveBeenCalled()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it.each(['cancel', 'change'])('surfaces fallback cancellation on %s and removes its input', async event => {
    vi.stubGlobal('showOpenFilePicker', undefined)
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event(event))
    })
    await expect(chooseAnsiFile()).rejects.toHaveProperty('name', 'AbortError')
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('cleans up and reports a fallback picker activation error', async () => {
    vi.stubGlobal('showOpenFilePicker', undefined)
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => { throw new Error('Picker unavailable') })
    await expect(chooseAnsiFile()).rejects.toThrow('Picker unavailable')
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})
