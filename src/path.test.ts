import { describe, expect, it } from 'vitest'
import { Editor, MAX_ROW, pointFromKey } from './model'
import { rgbColor } from './colors'
import { ansiChunks } from './export'
import { convertPathNode, rasterizePath, removePathNode, type BezierPath, type PathNode } from './path'

const node = (x: number, y: number): PathNode => ({
  point: { x, y }, incoming: { x, y }, outgoing: { x, y },
})
const box = (left: number, top: number, right: number, bottom: number, origin = 0): BezierPath => ({
  origin, closed: true, nodes: [node(left, top), node(right, top), node(right, bottom), node(left, bottom)],
})
const ink = { fg: 14, bg: 0 }

describe('Bezier path rasterization', () => {
  it('deletes any node, preserves closure when possible, and reopens undersized paths', () => {
    const path = box(2, 2, 8, 8)
    const result = removePathNode(path, 1)
    expect(result.nodes.map(node => node.point)).toEqual([{ x: 2, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }])
    expect(result.closed).toBe(true)
    expect(removePathNode(result, 0).closed).toBe(false)
    expect(path.nodes).toHaveLength(4)
    expect(() => removePathNode(path, -1)).toThrow(/Select/)
    expect(() => removePathNode(path, 4)).toThrow(/Select/)
  })

  it('converts corners into mirrored smooth handles and back without moving anchors', () => {
    const path = box(2, 2, 8, 8, 1_000_000_000)
    const curve = convertPathNode(path, 1, true)
    const node = curve.nodes[1]
    expect(node.point).toEqual(path.nodes[1].point)
    expect(node.incoming).not.toEqual(node.point)
    expect(node.outgoing).not.toEqual(node.point)
    expect(node.incoming.x + node.outgoing.x).toBeCloseTo(2 * node.point.x)
    expect(node.incoming.y + node.outgoing.y).toBeCloseTo(2 * node.point.y)
    expect(curve.closed).toBe(true)
    expect(convertPathNode(curve, 1, false)).toEqual(path)
    expect(path.nodes[1].outgoing).toEqual(path.nodes[1].point)
    expect(() => convertPathNode(path, 1.5, true)).toThrow(/Select/)
    const top = convertPathNode(box(0, 0, 4, 4), 1, true)
    expect([...rasterizePath(top, ink).keys()].every(id => pointFromKey(id).y >= 0)).toBe(true)
  })

  it('exports fitted halves as binary CP437 with exact reset and line-feed bytes', () => {
    const cells = rasterizePath(box(0, 0, 2, 0.5), { fg: 7, bg: 0 })
    const reset = [27, 91, 48, 109]
    expect([...ansiChunks(cells)].flatMap(chunk => [...chunk])).toEqual([
      ...reset, 27, 91, 50, 74, 27, 91, 72, 223, 223, ...reset, 13, 10, ...reset,
    ])
  })
  it('fits exact full, horizontal half and vertical half blocks', () => {
    expect(rasterizePath(box(2, 3, 4, 4), ink)).toEqual(new Map([
      ['2,3', { code: 219, ...ink }], ['3,3', { code: 219, ...ink }],
    ]))
    expect(rasterizePath(box(2, 3, 3, 3.5), ink).get('2,3')?.code).toBe(223)
    expect(rasterizePath(box(2, 3.5, 3, 4), ink).get('2,3')?.code).toBe(220)
    expect(rasterizePath(box(2, 3, 2.5, 4), ink).get('2,3')?.code).toBe(221)
    expect(rasterizePath(box(2.5, 3, 3, 4), ink).get('2,3')?.code).toBe(222)
  })

  it('uses cubic handles, including the closing segment, without mutating the draft', () => {
    const straight = box(10, 4, 20, 12)
    const curved = structuredClone(straight)
    curved.nodes[0].outgoing = { x: 10, y: 0 }
    curved.nodes[1].incoming = { x: 20, y: 0 }
    curved.nodes[3].outgoing = { x: 3, y: 12 }
    curved.nodes[0].incoming = { x: 3, y: 4 }
    const before = structuredClone(curved)
    const result = rasterizePath(curved, ink)
    expect(result.has('15,1')).toBe(true)
    expect(result.has('5,8')).toBe(true)
    expect(result.size).toBeGreaterThan(rasterizePath(straight, ink).size)
    expect(curved).toEqual(before)
  })

  it('keeps local subcell precision at billion-row and near-limit coordinates', () => {
    for (const origin of [1_000_000_000, MAX_ROW - 1]) {
      expect(rasterizePath(box(2, 0, 3, 0.5, origin), ink)).toEqual(new Map([
        [`2,${origin}`, { code: 223, ...ink }],
      ]))
    }
  })

  it('subtracts sparsely, preserves surviving inks, and uses the selected hole background', () => {
    const source = new Map([
      ['2,1000000000', { code: 219, fg: 12, bg: 1 }],
      ['3,1000000000', { code: 219, fg: 10, bg: 1 }],
      ['79,0', { code: 65, fg: 7, bg: 0 }],
    ])
    const before = structuredClone(source)
    expect(rasterizePath(box(2, 0, 4, 0.5, 1_000_000_000), { fg: 7, bg: 1 }, source)).toEqual(new Map([
      ['2,1000000000', { code: 220, fg: 12, bg: 1 }],
      ['3,1000000000', { code: 220, fg: 10, bg: 1 }],
    ]))
    expect(source).toEqual(before)
    expect(rasterizePath(box(2, 0, 4, 1, 1_000_000_000), { fg: 7, bg: 0 }, source).get('2,1000000000'))
      .toEqual({ code: 32, fg: 7, bg: 0 })
    expect(rasterizePath(box(2, 0, 4, 1), ink, new Map()).size).toBe(0)
    expect(rasterizePath(box(2, 0, 4, 1_000_000_001), ink, source).size).toBe(2)
  })

  it('approximates clipped text and shading with only valid blocks and original surviving colors', () => {
    for (const code of [65, 176, 177, 178, 223, 221, 32]) {
      const result = rasterizePath(box(0, 0, 1, 0.5), { fg: 7, bg: 1 },
        new Map([['0,0', { code, fg: 14, bg: 4 }]])).get('0,0')!
      expect([32, 219, 220, 223, 221, 222]).toContain(result.code)
      expect([7, 14, 4]).toContain(result.fg)
      expect(result.bg).toBe(1)
    }
  })

  it('commits as one transaction and preserves undo/redo and RGB support', () => {
    const editor = new Editor(undefined, undefined, 'tundra')
    const colors = { fg: rgbColor('#123456'), bg: rgbColor('#654321') }
    const edits = rasterizePath(box(0, 0, 3, 2), colors, undefined, 'tundra')
    for (const [id, cell] of edits) editor.paint(pointFromKey(id), cell)
    editor.commit()
    expect(editor.cells).toEqual(edits)
    editor.undo()
    expect(editor.cells.size).toBe(0)
    editor.redo()
    expect(editor.cells).toEqual(edits)
  })

  it('uses even-odd filling for self intersections and rejects invalid drafts and inks', () => {
    const crossed = { origin: 0, closed: true, nodes: [node(0, 0), node(4, 4), node(0, 4), node(4, 0)] }
    expect(rasterizePath(crossed, ink).size).toBeGreaterThan(0)
    expect(() => rasterizePath({ ...crossed, closed: false }, ink)).toThrow(/closed/)
    expect(() => rasterizePath({ ...crossed, nodes: [node(0, 0)] }, ink)).toThrow(/three/)
    expect(() => rasterizePath(box(0, 0, 1, 2, MAX_ROW), ink)).toThrow(/safe/)
    expect(() => rasterizePath(box(0, 0, 1, 1), { fg: 16, bg: 0 })).toThrow(/Invalid cell/)
    expect(() => rasterizePath(box(0, 0, 1, 1), { fg: 7, bg: 8 })).toThrow(/Invalid cell/)
    expect(() => rasterizePath({ ...crossed, nodes: [node(NaN, 0), ...crossed.nodes] }, ink)).toThrow(/safe/)
    expect(() => rasterizePath({ ...crossed, nodes: [node(0, Infinity), ...crossed.nodes] }, ink)).toThrow(/safe/)
    const complex = box(0, 0, 1, 1)
    complex.nodes[0].outgoing = { x: 1_000_000_000, y: 0 }
    expect(() => rasterizePath(complex, ink)).toThrow(/complex/)
  })
})
