import { useEffect, useRef, useState } from 'react'
import { emptySauce, validateSauce, type SauceMetadata } from './sauce'

export function SauceDialog({ sauce, rows, onApply, onClose }: {
  sauce?: SauceMetadata; rows: number; onApply(sauce: SauceMetadata | undefined): void; onClose(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(() => sauce ?? emptySauce())
  const [comments, setComments] = useState(() => sauce?.comments.join('\n') ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
    dialog.current?.querySelector('input')?.focus()
  }, [])
  const close = () => dialog.current?.close()
  const apply = (remove = false) => {
    try {
      const next = remove ? undefined : {
        ...draft,
        comments: comments === draft.comments.join('\n') ? draft.comments : comments ? comments.split('\n') : [],
      }
      if (next) validateSauce(next)
      onApply(next)
      close()
    } catch (cause) {
      console.error('ANSI Workshop SAUCE:', cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return <dialog ref={dialog} className="info-dialog sauce-dialog" aria-labelledby="sauce-dialog-title"
    onClose={onClose} onCancel={event => { event.preventDefault(); close() }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }}>
    <div className="info-dialog-header">
      <h2 id="sauce-dialog-title">SAUCE metadata</h2>
      <button type="button" onClick={close}>Cancel</button>
    </div>
    <form className="info-dialog-content" onSubmit={event => { event.preventDefault(); apply() }}>
      <p>{sauce ? 'This document has SAUCE00 metadata.' : 'This document has no SAUCE metadata. Apply adds a SAUCE00 record.'}
        {' '}Changes take effect only on Apply; save the ANSI document to write them.</p>
      <div className="sauce-fields">
        <label>Title <span className="muted">35 bytes</span>
          <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <label>Author <span className="muted">20 bytes</span>
          <input value={draft.author} onChange={event => setDraft({ ...draft, author: event.target.value })} />
        </label>
        <label>Group <span className="muted">20 bytes</span>
          <input value={draft.group} onChange={event => setDraft({ ...draft, group: event.target.value })} />
        </label>
        <label>Date <span className="muted">YYYYMMDD or blank</span>
          <input inputMode="numeric" placeholder="YYYYMMDD" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} />
        </label>
        <label className="sauce-comments">Comments <span className="muted">255 lines, 64 bytes per line</span>
          <textarea rows={6} value={comments} onChange={event => setComments(event.target.value)} />
        </label>
      </div>
      <p>Use CP437 characters. Unsupported characters and overlong fields are reported, never silently truncated.</p>
      <h3>Format information</h3>
      <dl className="sauce-format">
        <dt>ANSI save format</dt><dd>SAUCE00 · Character / ANSI · 80 columns</dd>
        <dt>Height on save</dt><dd>{rows > 65535 ? 'Unspecified (height exceeds the 16-bit field)' : `${rows} ${rows === 1 ? 'row' : 'rows'}`}</dd>
        <dt>Font hint</dt><dd>{draft.fontName || 'Unspecified'}</dd>
        <dt>Flags</dt><dd>{draft.flags} (iCE colors off)</dd>
        <dt>Additional type information</dt><dd>{draft.tinfo3} / {draft.tinfo4}</dd>
      </dl>
      <p>Font and display hints are preserved, not applied to the canvas. File size and dimensions are recomputed on ANSI save.
        {' '}ASCII and animation copies do not include SAUCE.</p>
      {error && <p role="alert">{error}</p>}
      <div className="ansimation-actions">
        <button type="submit">Apply</button>
        <button type="button" disabled={!sauce} onClick={() => apply(true)}>Remove SAUCE</button>
      </div>
    </form>
  </dialog>
}
