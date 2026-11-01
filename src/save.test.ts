import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseFile, hasNativeSave, writeAnsi, writeAscii, type AnsiFileHandle } from './save'
import { emptySauce } from './sauce'

function file() {
  const stream = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) }
  const handle: AnsiFileHandle = { name: 'screen.ans', createWritable: vi.fn().mockResolvedValue(stream) }
  return { stream, handle }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('native save capability', () => {
  it('offers the ASCII extension for an ASCII copy', async () => {
    const { handle } = file()
    const picker = vi.fn().mockResolvedValue(handle)
    vi.stubGlobal('showSaveFilePicker', picker)
    expect(await chooseFile('screen.asc', 'ascii')).toBe(handle)
    expect(picker).toHaveBeenCalledWith({
      suggestedName: 'screen.asc',
      types: [{ description: 'ASCII art (CP437, no ANSI codes)', accept: { 'application/octet-stream': ['.asc'] } }],
    })
  })
  it('uses download mode in Electron even when native picker APIs are exposed', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Code/1.144.0 Chrome/150.0.0.0 Electron/43.8.3 Safari/537.36')
    const picker = vi.fn().mockResolvedValue(file().handle)
    vi.stubGlobal('showSaveFilePicker', picker)
    expect(hasNativeSave()).toBe(false)
    expect(await chooseFile('screen.ans')).toBeUndefined()
    expect(picker).not.toHaveBeenCalled()
  })
  it('opens the native picker with only ANSI extensions and the suggested name', async () => {
    const { handle } = file()
    const picker = vi.fn().mockResolvedValue(handle)
    vi.stubGlobal('showSaveFilePicker', picker)
    expect(hasNativeSave()).toBe(true)
    expect(await chooseFile('screen.ans')).toBe(handle)
    expect(picker).toHaveBeenCalledWith({
      suggestedName: 'screen.ans',
      types: [{ description: 'ANSI art (CP437)', accept: { 'application/octet-stream': ['.ans'] } }],
    })
  })
  it('returns an explicit unsupported capability without opening any filesystem route', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined)
    expect(hasNativeSave()).toBe(false)
    expect(await chooseFile('screen.ans')).toBeUndefined()
  })
  it('propagates picker cancellation', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new DOMException('Canceled', 'AbortError')))
    await expect(chooseFile('screen.ans')).rejects.toHaveProperty('name', 'AbortError')
  })
})
describe('streaming save', () => {
  it('streams the complete SAUCE trailer and aborts if its final write fails', async () => {
    const { handle, stream } = file()
    const sauce = { ...emptySauce(), title: 'Art', comments: ['One'] }
    await writeAnsi(new Map(), handle, 'screen.ans', new AbortController().signal, sauce)
    const bytes = stream.write.mock.calls.flatMap(([chunk]) => [...chunk])
    expect(bytes.length).toBe(15 + 1 + 69 + 128)
    expect(bytes.slice(-128, -121)).toEqual([83, 65, 85, 67, 69, 48, 48])
    expect(stream.close).toHaveBeenCalledOnce()
    stream.write.mockImplementation(async (chunk: Uint8Array) => {
      if (chunk.length === 128) throw new Error('Trailer write failed')
    })
    stream.close.mockClear()
    await expect(writeAnsi(new Map(), handle, 'screen.ans', new AbortController().signal, sauce)).rejects.toThrow('Trailer write failed')
    expect(stream.abort).toHaveBeenCalledOnce()
    expect(stream.close).not.toHaveBeenCalled()
  })
  it('streams ASCII bytes through the same native writable lifecycle', async () => {
    const { handle, stream } = file()
    await writeAscii(new Map([['1,0', { code: 219, fg: 14, bg: 1 }]]), handle, 'screen.asc', new AbortController().signal)
    expect(stream.write.mock.calls.map(([chunk]) => [...chunk]).flat()).toEqual([32, 219, 13, 10])
    expect(stream.close).toHaveBeenCalledOnce()
    expect(stream.abort).not.toHaveBeenCalled()
  })
  it('closes an empty ASCII file without writing ANSI resets', async () => {
    const { handle, stream } = file()
    await writeAscii(new Map(), handle, 'screen.asc', new AbortController().signal)
    expect(stream.write).not.toHaveBeenCalled()
    expect(stream.close).toHaveBeenCalledOnce()
  })
  it('cancels a distant-row ASCII stream and aborts on ASCII disk errors', async () => {
    const { handle, stream } = file()
    const controller = new AbortController()
    stream.write.mockImplementation(async () => { controller.abort() })
    await expect(writeAscii(new Map([['0,1000000000', { code: 219, fg: 7, bg: 0 }]]), handle, 'screen.asc', controller.signal)).rejects.toHaveProperty('name', 'AbortError')
    expect(stream.write).toHaveBeenCalledOnce()
    expect(stream.abort).toHaveBeenCalledOnce()
    expect(stream.close).not.toHaveBeenCalled()
    stream.write.mockRejectedValue(new Error('Disk full'))
    await expect(writeAscii(new Map([['0,0', { code: 65, fg: 7, bg: 0 }]]), handle, 'screen.asc', new AbortController().signal)).rejects.toThrow('Disk full')
  })
  it('writes generated bytes and closes only on success', async () => {
    const { handle, stream } = file()
    await writeAnsi(new Map(), handle, 'screen.ans', new AbortController().signal)
    expect(stream.write).toHaveBeenCalledTimes(2)
    expect(stream.close).toHaveBeenCalledOnce()
    expect(stream.abort).not.toHaveBeenCalled()
  })
  it('aborts on disk errors and propagates them', async () => {
    const { handle, stream } = file()
    stream.write.mockRejectedValue(new Error('Disk full'))
    await expect(writeAnsi(new Map(), handle, 'screen.ans', new AbortController().signal)).rejects.toThrow('Disk full')
    expect(stream.abort).toHaveBeenCalledOnce()
    expect(stream.close).not.toHaveBeenCalled()
  })
  it('aborts a canceled save without claiming success', async () => {
    const { handle, stream } = file()
    const controller = new AbortController(); controller.abort()
    await expect(writeAnsi(new Map(), handle, 'screen.ans', controller.signal)).rejects.toHaveProperty('name', 'AbortError')
    expect(stream.write).not.toHaveBeenCalled()
    expect(stream.abort).toHaveBeenCalledOnce()
  })
  it('surfaces abort failure rather than swallowing it', async () => {
    const { handle, stream } = file()
    stream.write.mockRejectedValue(new Error('Write failed'))
    stream.abort.mockRejectedValue(new Error('Abort failed'))
    await expect(writeAnsi(new Map(), handle, 'screen.ans', new AbortController().signal)).rejects.toBeInstanceOf(AggregateError)
  })
  it.each(['ansi', 'ascii'] as const)('downloads a %s byte blob without sending a network request', async format => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const create = vi.fn().mockReturnValue('blob:local')
    const revoke = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create
      static revokeObjectURL = revoke
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(format === 'ansi' ? 'screen.ans' : 'screen.asc')
    })
    const write = format === 'ansi' ? writeAnsi : writeAscii
    await write(new Map([['0,0', { code: 219, fg: 7, bg: 0 }]]), undefined, format === 'ansi' ? 'screen.ans' : 'screen.asc', new AbortController().signal)
    expect(create).toHaveBeenCalledWith(expect.any(Blob))
    const blob: Blob = create.mock.calls[0][0]
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(blob)
    })
    expect([...new Uint8Array(buffer)]).toEqual(format === 'ascii' ? [219, 13, 10] : [
      27, 91, 48, 109, 27, 91, 50, 74, 27, 91, 72,
      219, 27, 91, 48, 109, 13, 10, 27, 91, 48, 109,
    ])
    expect(click).toHaveBeenCalledOnce()
    await vi.runAllTimersAsync()
    expect(revoke).toHaveBeenCalledWith('blob:local')
  })
  it.each(['ansi', 'ascii'] as const)('accepts exactly 64 MiB in %s fallback mode and rejects output above that threshold', async format => {
    vi.useFakeTimers()
    const create = vi.fn().mockReturnValue('blob:local')
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create
      static revokeObjectURL = vi.fn()
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const limit = 64 * 1024 * 1024
    const lastRow = (limit - (format === 'ansi' ? 22 : 4)) / 2
    const cells = new Map([[`${format === 'ansi' ? 0 : 1},${lastRow}`, { code: 65, fg: 7, bg: 0 }]])
    const write = format === 'ansi' ? writeAnsi : writeAscii
    const accepted = write(cells, undefined, 'screen.asc', new AbortController().signal)
    await vi.runAllTimersAsync()
    await accepted
    expect(create.mock.calls[0][0].size).toBe(limit)
    cells.clear()
    cells.set(`${format === 'ansi' ? 0 : 1},${lastRow + 1}`, { code: 65, fg: 7, bg: 0 })
    const rejected = expect(write(cells, undefined, 'screen.asc', new AbortController().signal)).rejects.toThrow('exceeds 64 MiB')
    await vi.runAllTimersAsync()
    await rejected
    expect(create).toHaveBeenCalledOnce()
  })
  it('cancels a distant-row stream before materializing the document', async () => {
    const { handle, stream } = file()
    const controller = new AbortController()
    stream.write.mockImplementation(async () => {
      if (stream.write.mock.calls.length === 3) controller.abort()
    })
    const cells = new Map([['0,1000000000', { code: 219, fg: 7, bg: 0 }]])
    await expect(writeAnsi(cells, handle, 'screen.ans', controller.signal)).rejects.toHaveProperty('name', 'AbortError')
    expect(stream.write).toHaveBeenCalledTimes(3)
    expect(stream.abort).toHaveBeenCalledOnce()
    expect(stream.close).not.toHaveBeenCalled()
  })
})
