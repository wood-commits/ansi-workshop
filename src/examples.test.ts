// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANSI_COLORS } from './ansi'
import { readAnsi } from './import'
import { Editor, WIDTH, pointFromKey, type Cell } from './model'
import { writeAnsi, type AnsiFileHandle } from './save'
import { glyphMask } from './vgaFont'

const directory = resolve('examples')
// Pin positions, bytes and both colors so a broken parser cannot pass by round-tripping itself.
// The LF-only example also has an artwork raster baseline from the supplied reference image.
const examples = [
  ['VD-AC2.ANS', 4001, 95, '582748ac0111ba089fe76a5db3070a7ebe42c8779934fc901d5b6ec2ca61601f'],
  ['VD-BLDE8.ANS', 5078, 137, 'd3c5ae9b872fab6a541ef9d7ae546a44f4343d6dc19a10ffce3dfc1edbf1c990'],
  ['VD-HUMA.ANS', 5620, 120, '6df717f32914fd0c19a76e5f32af2773a6dbe2fbb14b28f04286b08f3ab661d0'],
  ['VD-NCLOG.ANS', 332, 14, '6aa79f63659b7fac62a22547b79717d094138c467d2e7bc32cb7e1b4f63e2be2'],
  ['VD-NCMNU.ANS', 692, 22, '44924980c1ba54c6400341c8919a0170026bc28115ba9ce68c15c4456ad34655'],
  ['VD-STAT.ANS', 1210, 21, '9f2c94c342876c2ea3aaddb9c6d580935011738a1e3be72987a4e287e8de78a2'],
  ['VD-VND.ANS', 429, 14, '40723589a9dea104112531a23ac2cd15b984605f173b5f1245157dc9fb9212a6'],
  ['vd-tdraw1.ans', 8076, 148, '2b97eb1ec5ee3a25503d05256637c77cf64e505958197964fa7171e9e2a52741'],
] as const

function orderedCells(cells: ReadonlyMap<string, Cell>) {
  return [...cells].sort(([a], [b]) => {
    const p = pointFromKey(a), q = pointFromKey(b)
    return p.y - q.y || p.x - q.x
  })
}

function renderedHash(cells: ReadonlyMap<string, Cell>, artworkOnly = false): string {
  const hash = createHash('sha256')
  const palette = ANSI_COLORS.map(color => [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16)))
  let row = -1
  const pixels = new Uint8Array(WIDTH * 8 * 16 * 3)
  for (const [id, cell] of orderedCells(cells)) {
    const { x, y } = pointFromKey(id)
    if (y !== row) {
      if (row >= 0) hash.update(String(row)).update(pixels)
      pixels.fill(0)
      row = y
    }
    if (artworkOnly && (cell.code === 102 || cell.code === 118 || cell.code === 254)) continue
    const mask = glyphMask(cell.code)
    for (let py = 0; py < 16; py++) for (let px = 0; px < 8; px++) {
      const offset = (py * WIDTH * 8 + x * 8 + px) * 3
      pixels.set(palette[mask[py * 8 + px] ? cell.fg : cell.bg], offset)
    }
  }
  if (row >= 0) hash.update(String(row)).update(pixels)
  return hash.digest('hex')
}

async function nativeSave(cells: ReadonlyMap<string, Cell>): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const writable = {
    write: vi.fn(async (chunk: Uint8Array<ArrayBuffer>) => { chunks.push(chunk.slice()) }),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  }
  const handle: AnsiFileHandle = { name: 'roundtrip.ans', createWritable: async () => writable }
  await writeAnsi(cells, handle, handle.name, new AbortController().signal)
  expect(writable.close).toHaveBeenCalledOnce()
  expect(writable.abort).not.toHaveBeenCalled()
  return new Blob(chunks)
}

async function downloadSave(cells: ReadonlyMap<string, Cell>): Promise<Blob> {
  let downloaded: Blob | undefined
  const click = vi.fn()
  const anchor = { href: '', download: '', click }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    if (!(blob instanceof Blob)) throw new Error('Download must contain binary ANSI bytes.')
    downloaded = blob
    return 'blob:smoke-test'
  })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const saving = writeAnsi(cells, undefined, 'roundtrip.ans', new AbortController().signal)
  await vi.runAllTimersAsync()
  await saving
  expect(click).toHaveBeenCalledOnce()
  expect(anchor.download).toBe('roundtrip.ans')
  expect(revoke).toHaveBeenCalledWith('blob:smoke-test')
  if (!downloaded) throw new Error('Save did not request a download.')
  return downloaded
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('example loading and saving smoke tests', () => {
  it('covers every ANSI file in the examples directory', () => {
    expect(readdirSync(directory).filter(name => /\.ans$/i.test(name)).sort())
      .toEqual(examples.map(([name]) => name).sort())
  })

  it.each(examples)('opens %s at its expected coordinates and preserves its rendering through both save paths', async (name, count, lastRow, digest) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Names come only from the fixed fixture list above.
    const cells = await readAnsi(new Blob([readFileSync(resolve(directory, name))]), new AbortController().signal)
    const entries = orderedCells(cells)
    expect(cells.size).toBe(count)
    expect(pointFromKey(entries.at(-1)![0]).y).toBe(lastRow)
    expect(createHash('sha256').update(JSON.stringify(entries)).digest('hex')).toBe(digest)
    const editor = new Editor(cells)
    expect(editor.dirty).toBe(false)
    expect(editor.canUndo).toBe(false)
    const rendered = renderedHash(editor.cells)
    if (name === 'vd-tdraw1.ans') {
      // The reference's f, v and small-square glyphs differ from the licensed bundled font.
      expect(renderedHash(editor.cells, true)).toBe('6e613aea812fc25a86c33b5f72d31f972a032e347cdb79609fe3d785406928a6')
    }

    const native = await nativeSave(editor.cells)
    const download = await downloadSave(editor.cells)
    vi.useRealTimers()
    expect(await download.arrayBuffer()).toEqual(await native.arrayBuffer())
    for (const saved of [native, download]) {
      const reopened = new Editor(await readAnsi(saved, new AbortController().signal))
      expect(reopened.cells).toEqual(editor.cells)
      expect(renderedHash(reopened.cells)).toBe(rendered)
      expect(reopened.dirty).toBe(false)
      const savedAgain = await nativeSave(reopened.cells)
      expect(await savedAgain.arrayBuffer()).toEqual(await saved.arrayBuffer())
    }
  })
})
