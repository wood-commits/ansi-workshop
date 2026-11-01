// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ansiChunks } from './export'
import { readAnsiDocument } from './import'
import { Editor } from './model'
import { emptySauce, validateSauce, withSauce } from './sauce'

describe('SAUCE metadata', () => {
  it('round-trips CP437 fields and comments with exact trailer layout', async () => {
    const sauce = { ...emptySauce(), title: 'Café', author: 'Artist', group: 'Group', date: '20261101', comments: ['First', '', '█'], flags: 4, fontName: 'IBM VGA' }
    const cells = new Map([['0,2', { code: 219, fg: 14, bg: 1 }]])
    const plain = [...ansiChunks(cells)].flatMap(chunk => [...chunk])
    const bytes = Uint8Array.from([...ansiChunks(cells, sauce)].flatMap(chunk => [...chunk]))
    expect([...bytes.subarray(0, plain.length)]).toEqual(plain)
    expect(bytes[plain.length]).toBe(26)
    expect([...bytes.subarray(plain.length + 1, plain.length + 6)]).toEqual([67, 79, 77, 78, 84])
    const record = bytes.slice(-128)
    expect([...record.subarray(0, 11)]).toEqual([83, 65, 85, 67, 69, 48, 48, 67, 97, 102, 130])
    expect(new DataView(record.buffer).getUint32(90, true)).toBe(plain.length)
    expect([...record.subarray(94, 106)]).toEqual([1, 1, 80, 0, 3, 0, 0, 0, 0, 0, 3, 4])
    const loaded = await readAnsiDocument(new Blob([bytes]), new AbortController().signal)
    expect(loaded.cells).toEqual(cells)
    expect(loaded.sauce).toEqual(sauce)
  })

  it('keeps metadata optional and uses unspecified height for distant sparse rows', () => {
    const cells = new Map([['0,65535', { code: 65, fg: 7, bg: 0 }]])
    const record = [...ansiChunks(cells, emptySauce())].at(-1)!
    expect([...record.subarray(96, 100)]).toEqual([80, 0, 0, 0])
    expect([...ansiChunks(new Map())].at(-1)).toEqual(new Uint8Array([27, 91, 48, 109]))
  })

  it('checks the exact unsigned 32-bit content-size limit without allocating the file', () => {
    const chunk = new Uint8Array(1024 * 1024)
    function* content(lastByte: boolean) {
      for (let index = 0; index < 4095; index++) yield chunk
      yield chunk.subarray(0, chunk.length - 1)
      if (lastByte) yield new Uint8Array([65])
    }
    let record: Uint8Array<ArrayBuffer> | undefined
    for (const bytes of withSauce(content(false), emptySauce(), 1)) record = bytes
    expect(new DataView(record!.buffer).getUint32(90, true)).toBe(0xffffffff)
    expect(() => {
      for (const bytes of withSauce(content(true), emptySauce(), 1)) void bytes
    }).toThrow('32-bit')
  })

  it('retains 255 bounded comments and displays their control bytes without ANSI interpretation', async () => {
    const sauce = { ...emptySauce(), comments: Array<string>(255).fill('☺█') }
    const bytes = Uint8Array.from([...ansiChunks(new Map(), sauce)].flatMap(chunk => [...chunk]))
    expect(bytes.length).toBe(15 + 1 + 5 + 255 * 64 + 128)
    const loaded = await readAnsiDocument(new Blob([bytes]), new AbortController().signal)
    expect(loaded.sauce).toEqual(sauce)
    expect(loaded.cells.size).toBe(0)
  })

  it('validates byte lengths, CP437, actual dates, comments, and display flags', () => {
    for (const update of [
      { title: 'A'.repeat(36) }, { author: 'A'.repeat(21) }, { group: 'A'.repeat(21) },
      { title: '😀' }, { title: '\x1b' }, { date: '20260229' }, { date: '20261301' },
      { comments: ['A'.repeat(65)] }, { comments: Array<string>(256).fill('') },
      { flags: 1 }, { flags: 256 },
    ]) expect(() => validateSauce({ ...emptySauce(), ...update })).toThrow()
    expect(() => validateSauce({ ...emptySauce(), date: '20240229' })).not.toThrow()
  })

  it('tracks metadata in unified history and saved identity without sharing mutable values', () => {
    const original = { ...emptySauce(), title: 'Original', comments: ['One'] }
    const editor = new Editor(undefined, original)
    original.comments[0] = 'Mutated'
    expect(editor.sauce?.comments).toEqual(['One'])
    expect(editor.dirty).toBe(false)
    editor.setSauce({ ...emptySauce(), title: 'Edited' })
    const savingVersion = editor.version
    editor.paint({ x: 0, y: 1000000000 }, { code: 65, fg: 7, bg: 0 })
    editor.commit()
    editor.markSaved(savingVersion)
    expect(editor.dirty).toBe(true)
    editor.undo()
    expect(editor.dirty).toBe(false)
    editor.undo()
    expect(editor.sauce?.title).toBe('Original')
    editor.redo()
    expect(editor.sauce?.title).toBe('Edited')
    editor.setSauce(undefined)
    expect(editor.sauce).toBeUndefined()
    editor.undo()
    expect(editor.dirty).toBe(false)
    editor.setSauce(editor.sauce)
    expect(editor.dirty).toBe(false)
    expect(() => editor.setSauce({ ...emptySauce(), title: '😀' })).toThrow()
    expect(editor.dirty).toBe(false)
  })
})
