import { useCallback, useEffect, useRef, useState } from 'react'
import type { OcrResult } from './ocr/pipeline'
import { saveOutputs, pickDirectory, supportsDirPicker, type OutputSettings } from './ocr/save'
import { T, tr, type Lang } from './i18n'
import './App.css'

type Status = 'loading' | 'ready' | 'running'
const lang: Lang = 'ja'
const SAMPLES = [
  { file: 'sample_yoko.png', label: '横書き（活字）' },
  { file: 'sample_tate.png', label: '縦書き（活字）' },
]

export default function App() {
  const workerRef = useRef<Worker | null>(null)
  const resolveRef = useRef<((r: OcrResult) => void) | null>(null)
  const rejectRef = useRef<((e: string) => void) | null>(null)
  const cancelRef = useRef(false)

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
  const [showAbout, setShowAbout] = useState(false)

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
      else if (m.type === 'ready') { setStatus('ready'); setProgress(t('ready')) }
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

  const runList = useCallback(async (list: File[], listUrls: string[], save: boolean) => {
    if (list.length === 0) { setError(t('noTarget')); return }
    cancelRef.current = false
    setStatus('running'); setError('')
    const newResults: (OcrResult | null)[] = list.map(() => null)
    for (let i = 0; i < list.length; i++) {
      if (cancelRef.current) break
      setIdx(i)
      setProgress(`${i + 1}/${list.length} ${list[i].name}`)
      try {
        const res = await runOne(list[i])
        newResults[i] = res
        setResults([...newResults])
        if (save) await saveOutputs(dir, list[i].name, listUrls[i], res, { ...fmt, viz })
      } catch (err) { setError(String(err)) }
    }
    setStatus('ready')
    setProgress(cancelRef.current ? t('cancelRequested') : t('done'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, fmt, viz])

  const runOCR = () => runList(files, urls, true)
  const stopOCR = () => { cancelRef.current = true; setProgress(t('cancelRequested')) }

  const onSample = async (name: string) => {
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'samples/' + name)
      const blob = await res.blob()
      const file = new File([blob], name, { type: blob.type || 'image/png' })
      urls.forEach(u => URL.revokeObjectURL(u))
      const url = URL.createObjectURL(blob)
      setFiles([file]); setUrls([url]); setResults([null]); setIdx(0); setError(''); setCropResult(null); setCropMode(false)
      await runList([file], [url], false)
    } catch (err) { setError(String(err)) }
  }

  // ---- 範囲を選んでOCR ----
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
        <button className="help" onClick={() => setShowAbout(true)}>🔒 仕組みと安全性</button>
      </header>

      <main className="body">
        <div className="intro">
          国立国会図書館「<strong>NDLkotenOCR-Lite</strong>」(CC BY 4.0) を<strong>ベースに</strong>再構築。
          画像は<strong>あなたのパソコンの中だけ</strong>で処理され、外部に送信されません。
        </div>

        <div className="toolbar">
          <div className="trow">
            <button className="outlined" disabled={busy} onClick={onPickImage}>📄 {t('processImage')}</button>
            <button className="outlined" disabled={busy} onClick={onPickFolder}>📁 {t('processFolder')}</button>
            <span className="label">{t('target')}</span>
            <span className="path">{files.length ? (files.length === 1 ? files[0].name : `${files.length} 枚`) : '—'}</span>
            <span className="spacer" />
            <button className="chip" disabled={busy} onClick={onCapture}
              title="いま画面に表示しているもの（PDFビューアやWebページなど）を撮影して、その文字を読み取ります">🖥 {t('captureMode')}</button>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => e.target.files && setTargets(Array.from(e.target.files))} />
            <input ref={folderInput} type="file" hidden multiple onChange={e => e.target.files && setTargets(Array.from(e.target.files))} />
          </div>

          <div className="trow">
            <button className="outlined" disabled={busy} onClick={onSelectOutput}>{t('selectOutput')}</button>
            <span className="label">{t('output')}</span>
            <span className="path">{dirName || t('outputDownload')}</span>
            <span className="spacer" />
            <span className="lbl">保存形式：</span>
            <label className="check"><input type="checkbox" checked={fmt.txt} onChange={e => setFmt(s => ({ ...s, txt: e.target.checked }))} /> txt</label>
            <label className="check"><input type="checkbox" checked={fmt.json} onChange={e => setFmt(s => ({ ...s, json: e.target.checked }))} /> JSON</label>
            <label className="check"><input type="checkbox" checked={fmt.xml} onChange={e => setFmt(s => ({ ...s, xml: e.target.checked }))} /> XML</label>
            <label className="check"><input type="checkbox" checked={viz} onChange={e => setViz(e.target.checked)} /> 可視化画像</label>
          </div>

          <div className="trow">
            {status === 'running'
              ? <button className="filled stop" onClick={stopOCR}>{t('stopOcr')}</button>
              : <button className="filled" disabled={status === 'loading'} onClick={runOCR}>{t('ocr')}</button>}
            <button className={cropMode ? 'outlined on' : 'outlined'} disabled={busy || files.length === 0}
              onClick={() => setCropMode(v => !v)}
              title="画像の一部だけを枠で囲んで読み取ります。押してからプレビュー上をドラッグしてください">✂️ {t('cropOcr')}</button>
            <span className="spacer" />
            <span className="lbl">まず試す：</span>
            {SAMPLES.map(s => (
              <button key={s.file} className="sample" disabled={busy} onClick={() => onSample(s.file)} title={`サンプル（${s.label}）でOCRを体験`}>
                <img src={import.meta.env.BASE_URL + 'samples/' + s.file} alt={s.label} />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <div className="err">⚠️ {error}</div>}

        <div className="preview">
          {urls[idx] ? (
            <div className="pv-grid">
              <div className={`imgwrap ${cropMode ? 'crop' : ''}`}
                onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => { dragRef.current = null }}>
                <div className="imginner">
                  <img ref={imgRef} src={urls[idx]} alt="preview" draggable={false} />
                  {cur && (
                    <svg viewBox={`0 0 ${cur.width} ${cur.height}`} className="overlay" preserveAspectRatio="none">
                      {cur.lines.map((l, i) => <rect key={i} x={l.box.x1} y={l.box.y1} width={l.box.x2 - l.box.x1} height={l.box.y2 - l.box.y1} className="bbox" />)}
                    </svg>
                  )}
                  {sel && <div className="selbox" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }} />}
                </div>
                {cropMode && <div className="crophint">{t('cropHint')}</div>}
              </div>
              <div className="txtwrap">
                <div className="txthdr">
                  <span className="muted">
                    {cur ? `${cur.lines.length} 行 / ${Math.round(cur.ms)}ms / ${cur.vertical ? '縦書き' : '横書き'}` : (status === 'running' ? progress : '結果待ち')}
                  </span>
                  <span className="navs">
                    {files.length > 1 && <>
                      <button className="link" disabled={idx <= 0} onClick={() => setIdx(i => Math.max(0, i - 1))}>‹{t('prev')}</button>
                      <span className="muted">{idx + 1}/{files.length}</span>
                      <button className="link" disabled={idx >= files.length - 1} onClick={() => setIdx(i => Math.min(files.length - 1, i + 1))}>{t('next')}›</button>
                    </>}
                    {cur && <button className="link" onClick={() => navigator.clipboard.writeText(cur.text)}>{t('copy')}</button>}
                  </span>
                </div>
                {cur
                  ? <textarea readOnly value={cur.text} spellCheck={false} />
                  : <div className="ph">{status === 'running' ? progress : 'OCR結果がここに表示されます'}</div>}
              </div>
            </div>
          ) : (
            <div className="empty" onClick={() => !busy && onPickImage()}>
              {status === 'loading'
                ? <><div className="big">⏳ {t('loading')}</div><small className="loadnote">{t('loadingNote')}</small></>
                : <><div className="big">📄 画像をドロップ / クリックして選択</div><small>または上の「まず試す」でサンプルを体験できます</small></>}
            </div>
          )}
        </div>

        <div className="foot">
          {t('privacy')}　／　{t('engine')}　／　ソースコード: <a href="https://github.com/thebigeaterr/kotenocr-web" target="_blank" rel="noreferrer">github.com/thebigeaterr/kotenocr-web</a>
        </div>
      </main>

      {showAbout && (
        <div className="modal" onClick={() => setShowAbout(false)}>
          <div className="dlg about" onClick={e => e.stopPropagation()}>
            <h3>🔒 仕組みと安全性 — 画像はPCの外に出ません</h3>
            <p>ふつうのOCRは画像を<strong>サーバーに送って</strong>処理しますが、このツールは画像を<strong>あなたのパソコンの中だけ</strong>で処理します。画像は一歩も外に出ません。</p>
            <p className="tip">💡「ブラウザ＝インターネット」と思われがちですが、ブラウザは<strong>あなたのパソコンで動くアプリ</strong>です。文字の読み取りは、ネットの向こうではなく<strong>あなたのパソコン自身（CPU）</strong>が計算しています。</p>
            <h4>たとえ話（出前 🆚 自炊）</h4>
            <p><strong>出前</strong>＝食材（画像）をお店に送る。<strong>自炊</strong>＝道具（プログラム）を家に届けてもらい、自分の台所（あなたのパソコン）で調理。このツールは「自炊」なので、画像は家から出ません。</p>
            <h4>自分で確かめられます</h4>
            <p className="tip">ページを開いた後に<strong>ネットを切ってもOCRできます</strong>。外に送る仕組みなら切れた瞬間に止まるはず＝どこにも送っていない証拠です。</p>
            <h4>画像とプログラムの扱い</h4>
            <p>画像は処理が<strong>終わると消えます</strong>（保存されません）。最初に読み込むプログラム（約180MB）は<strong>あなたのパソコンの中</strong>に保存され、次回は再ダウンロード不要・オフラインでも使えます（ブラウザの「サイトデータを削除」で消去可）。結果ファイルは、あなたが保存した場所に置かれるだけです。</p>
            <h4>企業や役所でも安心</h4>
            <p>個人情報や<strong>機密文書を外部に送らない</strong>＝「情報の持ち出し」に当たりません。クラウドに上げないので漏えいリスクが発生せず、ソースコードも公開されており検証できます。</p>
            <p className="muted">※「ページを開く」「初回にプログラムを取り込む」ときだけ、ふつうのWeb閲覧と同じ通信が起きます（道具が届く通信。画像とは無関係です）。</p>
            <div className="dlg-actions"><button className="filled" onClick={() => setShowAbout(false)}>{t('close')}</button></div>
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
