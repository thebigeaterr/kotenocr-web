import { useCallback, useEffect, useRef, useState } from 'react'
import type { OcrResult } from './ocr/pipeline'
import { saveOutputs, pickDirectory, supportsDirPicker, type OutputSettings } from './ocr/save'
import { T, tr, type Lang } from './i18n'
import './App.css'

type Status = 'loading' | 'ready' | 'running'

export default function App() {
  const workerRef = useRef<Worker | null>(null)
  const resolveRef = useRef<((r: OcrResult) => void) | null>(null)
  const rejectRef = useRef<((e: string) => void) | null>(null)
  const cancelRef = useRef(false)

  const [lang, setLang] = useState<Lang>('ja')
  const [status, setStatus] = useState<Status>('loading')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const [files, setFiles] = useState<File[]>([])
  const [urls, setUrls] = useState<string[]>([])
  const [results, setResults] = useState<(OcrResult | null)[]>([])
  const [idx, setIdx] = useState(0)

  const [dir, setDir] = useState<any>(null)
  const [dirName, setDirName] = useState('')
  const [viz, setViz] = useState(true)
  const [fmt, setFmt] = useState<Omit<OutputSettings, 'viz'>>({ txt: true, json: true, xml: true })
  const [showSettings, setShowSettings] = useState(false)

  const [cropMode, setCropMode] = useState(false)
  const [cropResult, setCropResult] = useState<{ url: string; res: OcrResult } | null>(null)
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const dragRef = useRef<{ sx: number; sy: number } | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const folderInput = useRef<HTMLInputElement | null>(null)

  const t = (k: keyof typeof T) => tr(k, lang)

  useEffect(() => {
    const w = new Worker(new URL('./ocr/worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = w
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') setProgress(m.message ?? '')
      else if (m.type === 'ready') { setStatus('ready'); setProgress(tr('ready', 'ja')) }
      else if (m.type === 'result') { resolveRef.current?.(m.result as OcrResult); resolveRef.current = null }
      else if (m.type === 'error') { rejectRef.current?.(m.message); rejectRef.current = null }
    }
    w.postMessage({ type: 'init', base: import.meta.env.BASE_URL })
    return () => w.terminate()
  }, [])

  useEffect(() => { if (folderInput.current) (folderInput.current as any).webkitdirectory = true }, [])

  const runOne = useCallback((blob: Blob): Promise<OcrResult> => {
    return new Promise((resolve, reject) => {
      resolveRef.current = resolve; rejectRef.current = reject
      workerRef.current?.postMessage({ type: 'run', blob, cascade: true })
    })
  }, [])

  const isImage = (f: File) => /\.(jpe?g|png|tiff?|jp2|bmp|webp)$/i.test(f.name) || f.type.startsWith('image/')

  const setTargets = (list: File[]) => {
    urls.forEach(u => URL.revokeObjectURL(u))
    const imgs = list.filter(isImage)
    setFiles(imgs)
    setUrls(imgs.map(f => URL.createObjectURL(f)))
    setResults(imgs.map(() => null))
    setIdx(0); setError(''); setCropResult(null)
  }

  const onPickImage = () => fileInput.current?.click()
  const onPickFolder = () => folderInput.current?.click()

  const onSelectOutput = async () => {
    if (!supportsDirPicker()) { setError('このブラウザは出力先フォルダ選択に未対応です。結果はダウンロードされます。'); return }
    const h = await pickDirectory()
    if (h) { setDir(h); setDirName(h.name) }
  }

  const runOCR = useCallback(async () => {
    if (files.length === 0) { setError(t('noTarget')); return }
    cancelRef.current = false
    setStatus('running'); setError('')
    const newResults = [...results]
    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) break
      setIdx(i)
      setProgress(`${i + 1}/${files.length} ${files[i].name}`)
      try {
        const res = await runOne(files[i])
        newResults[i] = res
        setResults([...newResults])
        await saveOutputs(dir, files[i].name, urls[i], res, { ...fmt, viz })
      } catch (err) { setError(String(err)) }
    }
    setStatus('ready')
    setProgress(cancelRef.current ? t('cancelRequested') : t('done'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, urls, results, dir, fmt, viz, lang])

  const stopOCR = () => { cancelRef.current = true; setProgress(t('cancelRequested')) }

  // ---- Crop&OCR ----
  const onMouseDown = (e: React.MouseEvent) => {
    if (!cropMode || !imgRef.current) return
    const r = imgRef.current.getBoundingClientRect()
    dragRef.current = { sx: e.clientX - r.left, sy: e.clientY - r.top }
    setSel({ x: dragRef.current.sx, y: dragRef.current.sy, w: 0, h: 0 })
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current || !imgRef.current) return
    const r = imgRef.current.getBoundingClientRect()
    const cx = e.clientX - r.left, cy = e.clientY - r.top
    const { sx, sy } = dragRef.current
    setSel({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) })
  }
  const onMouseUp = async () => {
    if (!dragRef.current || !imgRef.current || !sel) { dragRef.current = null; return }
    dragRef.current = null
    const el = imgRef.current
    const scaleX = el.naturalWidth / el.clientWidth, scaleY = el.naturalHeight / el.clientHeight
    const rx = Math.round(sel.x * scaleX), ry = Math.round(sel.y * scaleY)
    const rw = Math.round(sel.w * scaleX), rh = Math.round(sel.h * scaleY)
    setSel(null)
    if (rw < 8 || rh < 8) return
    const src = await loadImg(urls[idx])
    const c = document.createElement('canvas'); c.width = rw; c.height = rh
    c.getContext('2d')!.drawImage(src, rx, ry, rw, rh, 0, 0, rw, rh)
    const blob = await new Promise<Blob>(res => c.toBlob(b => res(b!), 'image/png'))
    setStatus('running'); setProgress(t('cropOcr') + '…')
    try { const res = await runOne(blob); setCropResult({ url: URL.createObjectURL(blob), res }) }
    catch (err) { setError(String(err)) }
    setStatus('ready')
  }

  const onCapture = async () => {
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true })
      const track = stream.getVideoTracks()[0]
      const video = document.createElement('video'); video.srcObject = stream
      await video.play(); await new Promise(r => setTimeout(r, 300))
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight
      c.getContext('2d')!.drawImage(video, 0, 0)
      track.stop()
      const blob = await new Promise<Blob>(res => c.toBlob(b => res(b!), 'image/png'))
      setStatus('running'); setProgress(t('captureMode') + '…')
      const res = await runOne(blob)
      setCropResult({ url: URL.createObjectURL(blob), res }); setStatus('ready')
    } catch (err) { setError(String(err)) }
  }

  const busy = status === 'loading' || status === 'running'
  const cur = results[idx] ?? null

  return (
    <div className="page">
      <header className="appbar">
        <img className="logo" src={import.meta.env.BASE_URL + 'icon.svg'} alt="" />
        <div className="brand">
          <span className="name">{t('brand')}</span>
          <span className="tagline">{t('tagline')}</span>
        </div>
        <div className="tabs">
          <button className={lang === 'ja' ? 'tab on' : 'tab'} onClick={() => setLang('ja')}>日本語</button>
          <button className={lang === 'en' ? 'tab on' : 'tab'} onClick={() => setLang('en')}>English</button>
        </div>
      </header>

      <main className="body">
        <div className="row top">
          <span className="explain">{t('explain')}</span>
          <button className="chip" disabled={busy} onClick={onCapture}>{t('captureMode')}</button>
        </div>
        <hr />

        <div className="row">
          <button className="outlined" disabled={busy} onClick={onPickImage}>📄 {t('processImage')}</button>
          <button className="outlined" disabled={busy} onClick={onPickFolder}>📁 {t('processFolder')}</button>
          <span className="label">{t('target')}</span>
          <span className="path">{files.length ? (files.length === 1 ? files[0].name : `${files.length} 枚`) : '—'}</span>
          <input ref={fileInput} type="file" accept="image/*" hidden
            onChange={e => e.target.files && setTargets(Array.from(e.target.files))} />
          <input ref={folderInput} type="file" hidden multiple
            onChange={e => e.target.files && setTargets(Array.from(e.target.files))} />
        </div>
        <hr />

        <div className="row">
          <button className="outlined" disabled={busy} onClick={onSelectOutput}>{t('selectOutput')}</button>
          <span className="label">{t('output')}</span>
          <span className="path">{dirName || t('outputDownload')}</span>
        </div>
        <hr />

        <div className="row">
          {status === 'running'
            ? <button className="filled stop" onClick={stopOCR}>{t('stopOcr')}</button>
            : <button className="filled" disabled={status === 'loading'} onClick={runOCR}>{t('ocr')}</button>}
          <button className={cropMode ? 'outlined on' : 'outlined'} disabled={busy || files.length === 0}
            onClick={() => setCropMode(v => !v)}>{t('cropOcr')}</button>
          <label className="check"><input type="checkbox" checked={viz} onChange={e => setViz(e.target.checked)} /> {t('saveViz')}</label>
          <button className="link" onClick={() => setShowSettings(true)}>{t('outputFormat')}</button>
        </div>
        <hr />

        <div className="row prevhdr">
          <span className="label">{t('preview')}</span>
          <button className="outlined sm" disabled={idx <= 0} onClick={() => setIdx(i => Math.max(0, i - 1))}>{t('prev')}</button>
          <button className="outlined sm" disabled={idx >= files.length - 1} onClick={() => setIdx(i => Math.min(files.length - 1, i + 1))}>{t('next')}</button>
          {files.length > 1 && <span className="muted">{idx + 1} / {files.length}</span>}
          {status === 'loading' && <span className="muted">⏳ {t('loading')}…（{t('loadingNote')}）</span>}
          {status === 'running' && <span className="muted">🔎 {progress}</span>}
        </div>

        {error && <div className="err">⚠️ {error}</div>}

        <div className="preview">
          {urls[idx] ? (
            <div className="pv-grid">
              <div className={`imgwrap ${cropMode ? 'crop' : ''}`}
                onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => { dragRef.current = null }}>
                <img ref={imgRef} src={urls[idx]} alt="preview" draggable={false} />
                {cur && (
                  <svg viewBox={`0 0 ${cur.width} ${cur.height}`} className="overlay" preserveAspectRatio="none">
                    {cur.lines.map((l, i) => <rect key={i} x={l.box.x1} y={l.box.y1} width={l.box.x2 - l.box.x1} height={l.box.y2 - l.box.y1} className="bbox" />)}
                  </svg>
                )}
                {sel && <div className="selbox" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }} />}
                {cropMode && <div className="crophint">{t('cropHint')}</div>}
              </div>
              <div className="txtwrap">
                {cur ? <>
                  <div className="txthdr"><span className="muted">{cur.lines.length} 行 / {Math.round(cur.ms)}ms / {cur.vertical ? '縦書き' : '横書き'}</span>
                    <button className="link" onClick={() => navigator.clipboard.writeText(cur.text)}>{t('copy')}</button></div>
                  <textarea readOnly value={cur.text} spellCheck={false} />
                </> : <div className="ph">{status === 'running' ? progress : 'OCR結果がここに表示されます'}</div>}
              </div>
            </div>
          ) : (
            <div className="empty" onClick={onPickImage}>
              {status === 'loading' ? <>⏳ {t('loading')}…<br /><small>{t('loadingNote')}</small></> : <>📄 {t('processImage')}<br /><small>jpg・png・tiff など</small></>}
            </div>
          )}
        </div>

        <div className="foot">
          <div>{t('privacy')}</div>
          <div className="muted">{t('engine')}</div>
          <div className="muted">
            ソース: <a href="https://github.com/thebigeaterr/kotenocr-web" target="_blank" rel="noreferrer">github.com/thebigeaterr/kotenocr-web</a>
          </div>
        </div>
      </main>

      {showSettings && (
        <div className="modal" onClick={() => setShowSettings(false)}>
          <div className="dlg" onClick={e => e.stopPropagation()}>
            <h3>{t('settingTitle')}</h3>
            <p className="muted">{t('settingExplain')}</p>
            <label className="check"><input type="checkbox" checked={fmt.txt} onChange={e => setFmt(s => ({ ...s, txt: e.target.checked }))} /> テキスト (.txt)</label>
            <label className="check"><input type="checkbox" checked={fmt.json} onChange={e => setFmt(s => ({ ...s, json: e.target.checked }))} /> JSON (.json)</label>
            <label className="check"><input type="checkbox" checked={fmt.xml} onChange={e => setFmt(s => ({ ...s, xml: e.target.checked }))} /> XML (.xml)</label>
            <div className="dlg-actions"><button className="filled" onClick={() => setShowSettings(false)}>{t('close')}</button></div>
          </div>
        </div>
      )}

      {cropResult && (
        <div className="modal" onClick={() => setCropResult(null)}>
          <div className="dlg wide" onClick={e => e.stopPropagation()}>
            <h3>{t('resultTitle')}</h3>
            <div className="cropgrid">
              <img src={cropResult.url} alt="crop" />
              <textarea readOnly value={cropResult.res.text} spellCheck={false} />
            </div>
            <div className="dlg-actions">
              <span className="muted">{Math.round(cropResult.res.ms)}ms</span>
              <button className="link" onClick={() => navigator.clipboard.writeText(cropResult.res.text)}>{t('copy')}</button>
              <button className="filled" onClick={() => setCropResult(null)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = url })
}
