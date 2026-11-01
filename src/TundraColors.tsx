import { useId, useRef, useState } from 'react'
import { ANSI_COLORS } from './ansi'
import { ShadeGlyph } from './Canvas'
import { colorCss, rgbColor } from './colors'
import type { Cell } from './model'
import type { CanvasFont } from './vgaFont'

export function TundraColors({ fg, bg, code, font, cells, onFg, onBg, onError }: {
  fg: number; bg: number; code: number; font: CanvasFont; cells: ReadonlyMap<string, Cell>
  onFg(color: number): void; onBg(color: number): void; onError(error: Error): void
}) {
  const [name, setName] = useState('')
  const [swatches, setSwatches] = useState<{ color: number; name: string }[]>([])
  const [page, setPage] = useState(0)
  const [tab, setTab] = useState<'user' | 'used'>('user')
  const [activeSwatch, setActiveSwatch] = useState<number>()
  const userTab = useRef<HTMLButtonElement>(null)
  const usedTab = useRef<HTMLButtonElement>(null)
  const id = useId()
  const used = [...new Set([...cells.values()].flatMap(cell => [cell.fg, cell.bg]))].sort((a, b) => a - b)
  const lastPage = Math.max(0, Math.ceil(used.length / 64) - 1)
  const currentPage = Math.min(page, lastPage)
  const saveSwatch = (color: number) => {
    const label = name.trim()
    if (label.length > 48) { onError(new Error('Swatch names must be at most 48 characters.')); return }
    if (!swatches.some(swatch => swatch.color === color) && swatches.length >= 64) {
      onError(new Error('The swatches panel holds 64 saved colors. Remove one before adding another.'))
      return
    }
    setSwatches(previous => [...previous.filter(swatch => swatch.color !== color), { color, name: label }])
    setName('')
  }
  const chooseTab = (next: 'user' | 'used') => { setTab(next); setActiveSwatch(undefined) }
  const tabKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'user' : event.key === 'End' ? 'used' : tab === 'user' ? 'used' : 'user'
    chooseTab(next)
    const target = next === 'user' ? userTab : usedTab
    target.current?.focus()
  }
  const displayed = tab === 'user' ? swatches : used.slice(currentPage * 64, (currentPage + 1) * 64).map(color => ({ color, name: '' }))

  return <section className="panel color-panel" aria-label="TundraDraw colors">
    <div className="panel-heading"><h2>TundraDraw colors</h2><span className="badge">24-bit RGB</span></div>
    <div className="ink-preview">
      <div className="sample-cell" style={{ color: colorCss(fg), backgroundColor: colorCss(bg) }}>
        <ShadeGlyph code={code} color={colorCss(fg)} font={font} />
      </div>
      <div><strong>CP437 {code}</strong><span>RGB foreground / background</span></div>
      <button aria-label="Swap foreground and background" onClick={() => { onFg(bg); onBg(fg) }}>⇄</button>
    </div>
    {(['Foreground', 'Background'] as const).map(label => {
      const color = label === 'Foreground' ? fg : bg
      const select = label === 'Foreground' ? onFg : onBg
      return <div className="color-section" key={label}>
        <label className="rgb-picker">{label}
          <input type="color" aria-label={`${label} RGB`} value={colorCss(color)}
            onChange={event => {
              try { select(rgbColor(event.target.value)) }
              catch (error) { onError(error instanceof Error ? error : new Error(String(error))) }
            }} />
          <span>{colorCss(color)}</span>
        </label>
        <div className="color-grid">{ANSI_COLORS.map((hex, index) => <button key={hex}
          aria-label={`${label} preset ${hex}`} aria-pressed={color === index}
          style={{ backgroundColor: hex }} onClick={() => select(index)} />)}</div>
      </div>
    })}
    <h3>Swatches</h3>
    <div className="swatch-tabs" role="tablist" aria-label="Swatch collection">
      <button ref={userTab} id={`${id}-user`} role="tab" aria-selected={tab === 'user'} aria-controls={`${id}-panel`}
        tabIndex={tab === 'user' ? 0 : -1} onClick={() => chooseTab('user')} onKeyDown={tabKey}>User Defined</button>
      <button ref={usedTab} id={`${id}-used`} role="tab" aria-selected={tab === 'used'} aria-controls={`${id}-panel`}
        aria-label={`Currently Used (${used.length})`} tabIndex={tab === 'used' ? 0 : -1}
        onClick={() => chooseTab('used')} onKeyDown={tabKey}>Currently Used <span className="badge">{used.length}</span></button>
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
      {tab === 'user' && <>
        <label className="rgb-picker">Optional name<input aria-label="Swatch name" maxLength={48}
          value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="rgb-picker">
          <button onClick={() => saveSwatch(fg)}>Save FG swatch</button>
          <button onClick={() => saveSwatch(bg)}>Save BG swatch</button>
        </div>
      </>}
      <div className="swatch-grid">
        {displayed.map(swatch => {
          const label = swatch.name || colorCss(swatch.color)
          const active = activeSwatch === swatch.color
          return <div className="swatch-item" key={swatch.color}
            onMouseEnter={() => setActiveSwatch(swatch.color)}
            onMouseLeave={event => {
              if (!event.currentTarget.contains(event.currentTarget.ownerDocument.activeElement)) setActiveSwatch(undefined)
            }}
            onFocus={() => setActiveSwatch(swatch.color)}
            onBlur={event => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setActiveSwatch(undefined)
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation()
                event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus()
                setActiveSwatch(undefined)
              }
            }}>
            <button className="swatch-color" aria-label={`Swatch ${label}`} aria-expanded={active}
              aria-controls={active ? `${id}-actions-${swatch.color}` : undefined}
              style={{ backgroundColor: colorCss(swatch.color) }} onClick={() => setActiveSwatch(swatch.color)} />
            {active && <div className="swatch-actions" id={`${id}-actions-${swatch.color}`} role="group" aria-label={`Actions for ${label}`}>
              <strong>{label}</strong>
              {swatch.name && <span>{colorCss(swatch.color)}</span>}
              <div>
                <button aria-label={`Foreground ${label}`} onClick={() => onFg(swatch.color)}>FG</button>
                <button aria-label={`Background ${label}`} onClick={() => onBg(swatch.color)}>BG</button>
                {tab === 'user' && <button aria-label={`Remove swatch ${label}`} onClick={() => {
                  setSwatches(previous => previous.filter(item => item.color !== swatch.color))
                  setActiveSwatch(undefined); userTab.current?.focus()
                }}>Remove</button>}
              </div>
            </div>}
          </div>
        })}
      </div>
      {!displayed.length && <p className="color-note">{tab === 'user' ? 'No user-defined swatches yet.' : 'No colors in the drawing yet.'}</p>}
      {tab === 'used' && used.length > 64 && <div className="rgb-picker">
        <button disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setActiveSwatch(undefined) }}>Previous colors</button>
        <span>{currentPage + 1} / {lastPage + 1}</span>
        <button disabled={currentPage === lastPage} onClick={() => { setPage(currentPage + 1); setActiveSwatch(undefined) }}>Next colors</button>
      </div>}
    </div>
    <p className="color-note">Hover or focus a swatch for its name and FG/BG actions. Swatches are memory-only;
      New/Open/reload clears them. Ctrl+arrows cycle presets.</p>
  </section>
}
