import { supportsNativeFileAccess, type AnsiFileHandle } from './save'

export interface OpenedAnsiFile {
  file: File
  handle?: AnsiFileHandle
}
interface AnsiOpenHandle extends AnsiFileHandle {
  getFile(): Promise<File>
}
interface OpenPickerOptions {
  multiple: boolean
  types: { description: string; accept: Record<string, string[]> }[]
}
type OpenPickerWindow = Window & {
  showOpenFilePicker?: (options: OpenPickerOptions) => Promise<AnsiOpenHandle[]>
}

export async function chooseAnsiFile(): Promise<OpenedAnsiFile> {
  const picker = (window as OpenPickerWindow).showOpenFilePicker
  if (supportsNativeFileAccess() && picker) {
    const [handle] = await picker.call(window, {
      multiple: false,
      types: [{ description: 'ANSI art (CP437)', accept: { 'application/octet-stream': ['.ans'] } }],
    })
    if (!handle) throw new Error('No ANSI file was returned by the browser picker.')
    return { file: await handle.getFile(), handle }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.ans'
    input.hidden = true
    const cleanup = () => {
      input.removeEventListener('change', finish)
      input.removeEventListener('cancel', finish)
      input.remove()
    }
    const finish = () => {
      const file = input.files?.[0]
      cleanup()
      if (file) resolve({ file })
      else reject(new DOMException('File opening canceled.', 'AbortError'))
    }
    input.addEventListener('change', finish)
    input.addEventListener('cancel', finish)
    document.body.append(input)
    try { input.click() } catch (error) { cleanup(); reject(error) }
  })
}
