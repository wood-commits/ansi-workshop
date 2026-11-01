import { useEffect, useRef, useState } from 'react'
import { ANSI_COLORS } from './ansi'
import { drawGlyph } from './Canvas'
import { EFFECTS, FRAME_ROWS, MODEM_SPEEDS, AnsiPlayback, animationChunks, animationFrame, captureFrame, frameCount, type AnimationFrame, type AnimationOptions } from './ansimation'
import { WIDTH } from './model'
import { chooseAnsiFile } from './open'
import { readAnsi } from './import'
import { chooseFile, hasNativeSave, writeChunks } from './save'

export function AnsimationPanel({ source, name, top, onClose }: {
  source: AnimationFrame; name: string; top: number; onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const animation = useRef<number | undefined>(undefined)
  const operation = useRef<AbortController | undefined>(undefined)
  const [second, setSecond] = useState<AnimationFrame>()
  const [secondName, setSecondName] = useState('')
  const [effect, setEffect] = useState<AnimationOptions['effect']>('wipe')
  const [frames, setFrames] = useState(37)
  const [baud, setBaud] = useState(14400)
  const [playing, setPlaying] = useState(false)
  const [replayed, setReplayed] = useState(false)
  const [busy, setBusy] = useState<'load' | 'save'>()
  const [message, setMessage] = useState('Choose an effect, then Play. Originals stay unchanged.')
  const [error, setError] = useState('')
  const settings = { effect, frames }
  const selected = EFFECTS.find(item => item.id === effect)!
  const textOnly = selected.single === 'text'
  const automaticFrames = textOnly || effect === 'bullet-holes'
  const activeSecond = textOnly ? undefined : second

  const stop = () => {
    if (animation.current !== undefined) cancelAnimationFrame(animation.current)
    animation.current = undefined
    setPlaying(false)
  }
  const reset = () => { stop(); setReplayed(false) }
  const report = (cause: unknown) => {
    console.error('ANSI Workshop ansimation:', cause)
    setError(cause instanceof Error ? cause.message : String(cause))
  }
  const draw = (frame: AnimationFrame) => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) throw new Error('Unable to create the ansimation preview canvas.')
    frame.forEach((cell, index) => {
      const x = index % WIDTH * 8, y = Math.floor(index / WIDTH) * 16
      ctx.fillStyle = ANSI_COLORS[cell.bg]
      ctx.fillRect(x, y, 8, 16)
      ctx.fillStyle = ANSI_COLORS[cell.fg]
      drawGlyph(ctx, cell.code, x, y, 8, 16, 'ibm-vga')
    })
  }
  useEffect(() => {
    dialog.current?.showModal()
    return () => {
      if (animation.current !== undefined) cancelAnimationFrame(animation.current)
      operation.current?.abort()
    }
  }, [])
  useEffect(() => {
    const request = requestAnimationFrame(() => {
      try { draw(animationFrame(source, activeSecond, { effect, frames }, 0)) }
      catch (cause) { report(cause) }
    })
    return () => cancelAnimationFrame(request)
  }, [source, activeSecond, effect, frames])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const close = () => {
    stop()
    operation.current?.abort()
    dialog.current?.close()
  }
  const play = () => {
    stop(); setError('')
    try {
      const playback = new AnsiPlayback(animationChunks(source, activeSecond, settings), baud)
      let last: number | undefined
      const tick = (now: number) => {
        try {
          // Suspend transmission while hidden; do not fast-forward a long background interval.
          playback.advance(document.hidden || last === undefined ? 0 : Math.min(100, now - last))
          last = now
          draw(playback.frame())
          if (playback.complete) {
            animation.current = undefined
            setPlaying(false)
            setMessage(`Preview finished: ${playback.transmittedBytes.toLocaleString()} bytes at ${MODEM_SPEEDS.find(speed => speed.baud === baud)?.label}.`)
          } else animation.current = requestAnimationFrame(tick)
        } catch (cause) { stop(); setMessage('Preview failed.'); report(cause) }
      }
      setPlaying(true); setReplayed(true)
      setMessage('Playing the exported byte stream. Stop or change an option to stop playback.')
      animation.current = requestAnimationFrame(tick)
    } catch (cause) { report(cause) }
  }
  const load = async () => {
    if (operation.current) return
    reset(); setError('')
    const controller = new AbortController()
    operation.current = controller
    setBusy('load'); setMessage('Choose a second ANSI. Its first 25 rows will be used.')
    try {
      const { file } = await chooseAnsiFile()
      controller.signal.throwIfAborted()
      const cells = await readAnsi(file, controller.signal)
      controller.signal.throwIfAborted()
      setSecond(captureFrame(cells, 0)); setSecondName(file.name)
      setMessage('Second ANSI loaded. Neither original is changed.')
    } catch (cause) {
      if ((controller.signal.aborted && cause === controller.signal.reason) ||
          (cause instanceof DOMException && cause.name === 'AbortError')) {
        setMessage('Load canceled. Originals are unchanged.')
      } else { setMessage('Load failed. Originals are unchanged.'); report(cause) }
    } finally { operation.current = undefined; setBusy(undefined) }
  }
  const save = async () => {
    if (operation.current) return
    stop(); setError('')
    const controller = new AbortController()
    operation.current = controller
    setBusy('save')
    const outputName = `${name.replace(/\.[^.]*$/, '')}-ansimation.ans`
    try {
      const handle = await chooseFile(outputName)
      controller.signal.throwIfAborted()
      await writeChunks(animationChunks(source, activeSecond, settings), handle, outputName, controller.signal)
      setMessage(handle ? `Saved animation copy ${handle.name}. Original document and its save destination are unchanged.`
        : 'Download requested. Check your browser downloads; delivery cannot be verified.')
    } catch (cause) {
      if ((controller.signal.aborted && cause === controller.signal.reason) ||
          (cause instanceof DOMException && cause.name === 'AbortError')) setMessage('Export canceled. Originals are unchanged.')
      else { setMessage('Export failed.'); report(cause) }
    } finally { operation.current = undefined; setBusy(undefined) }
  }

  return <dialog ref={dialog} className="info-dialog ansimation-dialog" aria-labelledby="ansimation-title"
    onClose={onClose} onCancel={event => { event.preventDefault(); close() }}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); close() }
    }}>
    <div className="info-dialog-header">
      <h2 id="ansimation-title">Ansimation <span className="muted">Experimental</span></h2>
      <button onClick={close} aria-label="Close ansimation">Close</button>
    </div>
    <div className="info-dialog-content">
      <p><strong>80 × 25</strong> · {name} · rows {top + 1}–{top + FRAME_ROWS}. This is a snapshot; your art and undo history stay untouched.</p>
      <div className="ansimation-controls">
        <label>Effect<select aria-label="Effect" value={effect} disabled={!!busy} onChange={event => {
          const next = EFFECTS.find(item => item.id === event.target.value)
          if (!next) { report(new Error('Unknown ansimation effect.')); return }
          reset(); setEffect(next.id)
        }}>{EFFECTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {!automaticFrames && <label>Frame detail<select aria-label="Frame detail" value={frames} disabled={!!busy} onChange={event => {
          const next = Number(event.target.value)
          if (![13, 37, 73].includes(next)) { report(new Error('Unknown frame detail.')); return }
          reset(); setFrames(next)
        }}>
          <option value={13}>Quick (13 frames)</option><option value={37}>Normal (37 frames)</option><option value={73}>Smooth (73 frames)</option>
        </select></label>}
        <label>Preview speed<select aria-label="Preview speed" value={baud} disabled={!!busy} onChange={event => {
          const next = MODEM_SPEEDS.find(speed => speed.baud === Number(event.target.value))
          if (!next) { report(new Error('Unknown modem speed.')); return }
          reset(); setBaud(next.baud)
        }}>{MODEM_SPEEDS.map(speed => <option key={speed.baud} value={speed.baud}>{speed.label}</option>)}</select></label>
      </div>
      <p>{selected.description} {textOnly ? 'Single ANSI: reveal letters and digits; decorative art stays fixed.' : activeSecond ? `Transition: ${name} → ${secondName}.` : selected.single === 'erase' ? 'Single ANSI: art → blank.' : 'Single ANSI: blank → art.'}</p>
      {textOnly && <p className="muted">{frameCount(settings, source) === 1 ? 'No ASCII letters or digits were found. This effect leaves the art unchanged.'
        : `${frameCount(settings, source).toLocaleString()} frames generated automatically so every letter completes its animation.`}
        {second && ' The second ANSI is retained for other effects, but is not used here.'}
        {effect === 'text-slide' && ' Moving letters can cross blank spaces, hide behind decorative glyphs, and preserve background colors.'}</p>}
      {effect === 'bullet-holes' && <p className="muted">{frameCount(settings, source)} frames generated automatically so debris clears before each new hole.
        Circular cuts overlap until the whole screen is revealed.</p>}
      <div className="ansimation-actions">
        {!textOnly && <button disabled={!!busy} onClick={() => void load()}>{second ? 'Replace second ANSI' : 'Load second ANSI'}</button>}
        {!textOnly && second && <button disabled={!!busy} onClick={() => { reset(); setSecond(undefined); setSecondName(''); setMessage('Using a single ANSI.'); }}>Use single ANSI</button>}
        <button disabled={!!busy} onClick={playing ? () => { stop(); setMessage('Preview stopped. Replay starts from the beginning.'); } : play}>{playing ? 'Stop' : replayed ? 'Replay' : 'Play'}</button>
        <button disabled={!!busy} onClick={() => void save()}>Export ANSI</button>
        {busy && <button onClick={() => operation.current?.abort()}>Cancel {busy === 'load' ? 'load' : 'export'}</button>}
      </div>
      <canvas ref={canvas} width={640} height={400} className="ansimation-preview" aria-label="Ansimation preview" />
      <p className="muted">Preview approximates serial 8N1 (10 bits per byte), without modem compression or network latency.
        Frame detail changes the number of generated steps, not a timed duration. Playback pauses in background tabs.</p>
      <p className="muted">Export is binary CP437 for an 80×25 ANSI terminal. Plain .ans has no portable frame delays:
        your BBS/player output speed controls timing; fast viewers may show only the final screen.
        The preview speed is not embedded in the file. No video, timeline, or automatic looping.</p>
      <p className="muted">{hasNativeSave() ? 'Export chooses a separate browser-authorized file.' : 'Export requests a browser download; disk delivery cannot be verified.'}</p>
      {error && <p role="alert">{error}</p>}
      <p role="status">{message}</p>
    </div>
  </dialog>
}
