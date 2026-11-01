import { ansiChunks, asciiChunks } from './export'
import type { Cell } from './model'
import type { SauceMetadata } from './sauce'

export interface AnsiFileHandle {
  name: string
  createWritable(): Promise<{
    write(data: Uint8Array<ArrayBuffer>): Promise<void>
    close(): Promise<void>
    abort(): Promise<void>
  }>
}
export interface SavePickerOptions {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}
type PickerWindow = Window & { showSaveFilePicker?: (options: SavePickerOptions) => Promise<AnsiFileHandle> }
export function supportsNativeFileAccess(): boolean {
  // Electron exposes pickers even when its host blocks all file-handle operations.
  return !/\bElectron\//.test(navigator.userAgent)
}
export function hasNativeSave(): boolean {
  return supportsNativeFileAccess() && typeof (window as PickerWindow).showSaveFilePicker === 'function'
}
export async function chooseFile(name: string, format: 'ansi' | 'ascii' = 'ansi'): Promise<AnsiFileHandle | undefined> {
  if (!hasNativeSave()) return undefined
  const picker = (window as PickerWindow).showSaveFilePicker
  if (!picker) return undefined
  return picker.call(window, {
    suggestedName: name,
    types: [{
      description: format === 'ascii' ? 'ASCII art (CP437, no ANSI codes)' : 'ANSI art (CP437)',
      accept: { 'application/octet-stream': [format === 'ascii' ? '.asc' : '.ans'] },
    }],
  })
}

export async function writeAnsi(
  cells: ReadonlyMap<string, Cell>,
  handle: AnsiFileHandle | undefined,
  name: string,
  signal: AbortSignal,
  sauce?: SauceMetadata,
): Promise<void> {
  await writeChunks(ansiChunks(cells, sauce), handle, name, signal)
}

export async function writeAscii(
  cells: ReadonlyMap<string, Cell>,
  handle: AnsiFileHandle | undefined,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  await writeChunks(asciiChunks(cells), handle, name, signal)
}

export async function writeChunks(
  source: Iterable<Uint8Array<ArrayBuffer>>,
  handle: AnsiFileHandle | undefined,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  const writable = handle ? await handle.createWritable() : undefined
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let downloadSize = 0, count = 0
  try {
    for (const chunk of source) {
      signal.throwIfAborted()
      if (writable) await writable.write(chunk)
      else {
        downloadSize += chunk.byteLength
        if (downloadSize > 64 * 1024 * 1024) throw new Error('Download fallback exceeds 64 MiB. Use Chrome or Edge native Save As to stream this document without a file-size cap.')
        chunks.push(chunk)
      }
      if (++count % 64 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    signal.throwIfAborted()
    if (writable) await writable.close()
    else {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/octet-stream' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
  } catch (error) {
    if (writable) {
      try { await writable.abort() } catch (abortError) {
        throw new AggregateError([error, abortError], 'Saving failed and the browser could not abort the temporary file.', { cause: abortError })
      }
    }
    throw error
  }
}
