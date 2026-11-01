import { CP437, characterCode } from './ansi'
import type { DocumentFormat } from './colors'
import { validateWidth, WIDTH } from './model'

export interface SauceMetadata {
  readonly title: string
  readonly author: string
  readonly group: string
  readonly date: string
  readonly comments: readonly string[]
  readonly flags: number
  readonly fontName: string
  readonly tinfo3: number
  readonly tinfo4: number
}

const controlGlyphs = [...'␀☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼']

export function emptySauce(): SauceMetadata {
  return { title: '', author: '', group: '', date: '', comments: [], flags: 0, fontName: '', tinfo3: 0, tinfo4: 0 }
}

function encode(text: string, length: number, label: string): Uint8Array<ArrayBuffer> {
  const characters = [...text]
  if (characters.length > length) throw new Error(`${label} exceeds ${length} CP437 bytes.`)
  const bytes = new Uint8Array(length).fill(32)
  characters.forEach((character, index) => {
    const code = characterCode(character) ?? controlGlyphs.indexOf(character)
    if (code < 0) throw new Error(`${label} must contain only CP437 characters, without control characters.`)
    bytes[index] = code
  })
  return bytes
}

function decode(bytes: Uint8Array): string {
  let end = bytes.length
  while (end && (bytes[end - 1] === 0 || bytes[end - 1] === 32)) end--
  return Array.from(bytes.subarray(0, end), byte => byte < 32 ? controlGlyphs[byte] : CP437[byte]).join('')
}

export function validateSauce(sauce: SauceMetadata, format: DocumentFormat = 'ansi'): void {
  encode(sauce.title, 35, 'Title')
  encode(sauce.author, 20, 'Author')
  encode(sauce.group, 20, 'Group')
  encode(sauce.fontName, 22, 'Font name')
  if (sauce.date) {
    const year = Number(sauce.date.slice(0, 4)), month = Number(sauce.date.slice(4, 6)), day = Number(sauce.date.slice(6, 8))
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (!/^\d{8}$/.test(sauce.date) || year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
      throw new Error('SAUCE date must be a real date in YYYYMMDD format, or blank.')
    }
  }
  if (sauce.comments.length > 255) throw new Error('SAUCE supports at most 255 comment lines.')
  sauce.comments.forEach(line => encode(line, 64, 'Comment line'))
  if (!Number.isInteger(sauce.flags) || sauce.flags < 0 || sauce.flags > 255) {
    throw new Error('SAUCE flags must fit an unsigned 8-bit value.')
  }
  if (format === 'ansi' && (sauce.flags & 1)) {
    throw new Error('SAUCE iCE colors are not supported; flags must be a byte with iCE colors disabled.')
  }
  for (const value of [sauce.tinfo3, sauce.tinfo4]) {
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('SAUCE type information must fit an unsigned 16-bit value.')
  }
}

export function copySauce(sauce: SauceMetadata | undefined): SauceMetadata | undefined {
  return sauce && Object.freeze({ ...sauce, comments: Object.freeze([...sauce.comments]) })
}

export function sameSauce(a: SauceMetadata | undefined, b: SauceMetadata | undefined): boolean {
  return a === b || !!a && !!b && a.title === b.title && a.author === b.author && a.group === b.group &&
    a.date === b.date && a.flags === b.flags && a.fontName === b.fontName && a.tinfo3 === b.tinfo3 &&
    a.tinfo4 === b.tinfo4 && a.comments.length === b.comments.length && a.comments.every((line, index) => line === b.comments[index])
}

export async function readSauce(file: Blob, format: DocumentFormat = 'ansi'): Promise<{ content: Blob; sauce?: SauceMetadata; width?: number }> {
  if (file.size < 128) return { content: file }
  const record = new Uint8Array(await file.slice(file.size - 128).arrayBuffer())
  if (String.fromCharCode(...record.subarray(0, 5)) !== 'SAUCE') return { content: file }
  if (record[5] !== 48 || record[6] !== 48) throw new Error('Unsupported SAUCE version; only SAUCE00 is supported.')
  if (record[94] !== 1 || (format === 'tundra' ? record[95] !== 8 : record[95] !== 0 && record[95] !== 1)) {
    throw new Error('Unsupported SAUCE file type for this document format.')
  }
  const view = new DataView(record.buffer)
  const width = view.getUint16(96, true)
  if (width !== 0) validateWidth(width)
  let end = file.size - 128
  const comments: string[] = []
  if (record[104]) {
    const length = 5 + record[104] * 64
    end -= length
    if (end < 0) throw new Error('Truncated SAUCE comment block.')
    const block = new Uint8Array(await file.slice(end, end + length).arrayBuffer())
    if (String.fromCharCode(...block.subarray(0, 5)) !== 'COMNT') throw new Error('Invalid SAUCE comment block signature.')
    for (let index = 0; index < record[104]; index++) comments.push(decode(block.subarray(5 + index * 64, 69 + index * 64)))
  }
  const sauce: SauceMetadata = {
    title: decode(record.subarray(7, 42)), author: decode(record.subarray(42, 62)),
    group: decode(record.subarray(62, 82)), date: decode(record.subarray(82, 90)), comments,
    flags: record[105], fontName: decode(record.subarray(106, 128)),
    tinfo3: view.getUint16(100, true), tinfo4: view.getUint16(102, true),
  }
  // FileSize and height are advisory, never allocation or content-boundary inputs.
  return { content: file.slice(0, end), sauce: copySauce(sauce), width: width || undefined }
}

export function* withSauce(
  source: Iterable<Uint8Array<ArrayBuffer>>, sauce: SauceMetadata, height: number, format: DocumentFormat = 'ansi', width = WIDTH,
): Generator<Uint8Array<ArrayBuffer>> {
  validateWidth(width)
  validateSauce(sauce, format)
  let size = 0
  for (const chunk of source) {
    size += chunk.length
    if (size > 0xffffffff) throw new Error('SAUCE file size exceeds its 32-bit field. Remove SAUCE metadata before saving files larger than 4 GiB.')
    yield chunk
  }
  yield new Uint8Array([26])
  if (sauce.comments.length) {
    const block = new Uint8Array(5 + sauce.comments.length * 64)
    block.set([67, 79, 77, 78, 84])
    sauce.comments.forEach((line, index) => block.set(encode(line, 64, 'Comment line'), 5 + index * 64))
    yield block
  }
  const record = new Uint8Array(128)
  record.set([83, 65, 85, 67, 69, 48, 48])
  record.set(encode(sauce.title, 35, 'Title'), 7)
  record.set(encode(sauce.author, 20, 'Author'), 42)
  record.set(encode(sauce.group, 20, 'Group'), 62)
  record.set(encode(sauce.date, 8, 'Date'), 82)
  const view = new DataView(record.buffer)
  view.setUint32(90, size, true)
  record[94] = 1
  record[95] = format === 'tundra' ? 8 : 1
  view.setUint16(96, width, true)
  view.setUint16(98, height <= 65535 ? height : 0, true)
  view.setUint16(100, sauce.tinfo3, true)
  view.setUint16(102, sauce.tinfo4, true)
  record[104] = sauce.comments.length
  record[105] = format === 'tundra' ? sauce.flags : (sauce.flags & ~1) | Number(format === 'ice')
  record.set(encode(sauce.fontName, 22, 'Font name'), 106)
  yield record
}
