import { useCallback, useEffect, useRef, useState } from 'react'
import type { OcrResult } from './ocr/pipeline'
import { saveOutputs, pickDirectory, supportsDirPicker, type OutputSettings } from './ocr/save'
import { T, tr, type Lang } from './i18n'
import './App.css'

type Status = 'loading' | 'ready' | 'running'
const lang: Lang = 'ja'

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
  }, [files, urls, results, dir, fmt, viz])

  const stopOCR = () => { cancelRef.current = true; setProgress(t('cancelRequested')) }

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
      </header>

      <main className="body">
        {/* 出自と安全性の案内 */}
        <div className="banner">
          <div className="btxt">
            これは、<strong>国立国会図書館</strong>のOCR「<strong>NDLkotenOCR-Lite</strong>」(CC BY 4.0) を<strong>ベースに</strong>、
            インストール不要で<strong>ブラウザだけで動く</strong>ように再構築したものです。
            画像は<strong>あなたのPCの中だけ</strong>で処理され、外部には送信されません。
          </div>
          <button className="help" onClick={() => setShowAbout(true)}>🔒 仕組みと安全性</button>
        </div>

        <div className="row top">
          <span className="explain">{t('explain')}</span>
          <button className="chip" disabled={busy} onClick={onCapture}
            title="いま画面に表示しているもの（PDFビューアやWebページなど）を撮影して、その文字を読み取ります">
            🖥 {t('captureMode')}
          </button>
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

        {/* 保存形式を1階層目で直接選択 */}
        <div className="row fmts">
          <span className="lbl">保存形式：</span>
          <label className="check"><input type="checkbox" checked={fmt.txt} onChange={e => setFmt(s => ({ ...s, txt: e.target.checked }))} /> テキスト(.txt)</label>
          <label className="check"><input type="checkbox" checked={fmt.json} onChange={e => setFmt(s => ({ ...s, json: e.target.checked }))} /> JSON(.json)</label>
          <label className="check"><input type="checkbox" checked={fmt.xml} onChange={e => setFmt(s => ({ ...s, xml: e.target.checked }))} /> XML(.xml)</label>
          <label className="check"><input type="checkbox" checked={viz} onChange={e => setViz(e.target.checked)} /> {t('saveViz')}</label>
        </div>
        <hr />

        <div className="row">
          {status === 'running'
            ? <button className="filled stop" onClick={stopOCR}>{t('stopOcr')}</button>
            : <button className="filled" disabled={status === 'loading'} onClick={runOCR}>{t('ocr')}</button>}
          <button className={cropMode ? 'outlined on' : 'outlined'} disabled={busy || files.length === 0}
            onClick={() => setCropMode(v => !v)}
            title="画像の一部だけを枠で囲んで読み取ります。押してからプレビュー上をドラッグしてください">
            ✂️ {t('cropOcr')}
          </button>
        </div>
        <hr />

        <div className="row prevhdr">
          <span className="label">{t('preview')}</span>
          <button className="outlined sm" disabled={idx <= 0} onClick={() => setIdx(i => Math.max(0, i - 1))}>{t('prev')}</button>
          <button className="outlined sm" disabled={idx >= files.length - 1} onClick={() => setIdx(i => Math.min(files.length - 1, i + 1))}>{t('next')}</button>
          {files.length > 1 && <span className="muted">{idx + 1} / {files.length}</span>}
          {status === 'loading' && <span className="muted">⏳ {t('loadingShort')}</span>}
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
              {status === 'loading' ? <>⏳ {t('loading')}<br /><small className="loadnote">{t('loadingNote')}</small></> : <>📄 {t('processImage')}<br /><small>jpg・png・tiff など</small></>}
            </div>
          )}
        </div>

        <div className="foot">
          <div>{t('privacy')}</div>
          <div className="muted">{t('engine')}</div>
          <div className="muted">
            ソースコード: <a href="https://github.com/thebigeaterr/kotenocr-web" target="_blank" rel="noreferrer">github.com/thebigeaterr/kotenocr-web</a>
          </div>
        </div>
      </main>

      {showAbout && (
        <div className="modal" onClick={() => setShowAbout(false)}>
          <div className="dlg about" onClick={e => e.stopPropagation()}>
            <h3>🔒 仕組みと安全性 — 画像はPCの外に出ません</h3>

            <p><strong>ふつうのOCR</strong>は、画像を「どこかのサーバーに送って」文字にします。
            このツールは、画像を「<strong>あなたのPCの中だけ</strong>」で文字にします。だから画像は一歩も外に出ません。</p>

            <h4>たとえ話：出前 🆚 自炊</h4>
            <p>
              <strong>ふつうのOCRサービス（出前）</strong>：食材（＝あなたの画像）をお店に送って調理してもらう → 食材が外に出る。<br />
              <strong>このツール（自炊）</strong>：レシピと調理道具（＝画像処理プログラム）を家に届けてもらい、自分の台所（＝ブラウザ）で調理 → 食材は家から一歩も出ない。
            </p>

            <h4>データの「向き」</h4>
            <p>
              ・<strong>来る</strong>もの：画像処理プログラム（最初の1回だけ）<br />
              ・<strong>出ていく</strong>もの：画像 → <strong>ゼロ</strong>
            </p>

            <h4>自分で確かめられます（一番の証拠）</h4>
            <p className="tip">
              ① ページを一度開く → ② Wi-Fi（ネット）を切る → ③ その状態でOCRしてみる。<br />
              <strong>ネットを切っても、ふつうに動きます。</strong>
              もし画像を外部に送る仕組みなら、ネットが切れたら動かないはず。
              「ネットなしで動く＝どこにも送っていない」動かぬ証拠です。
            </p>

            <h4>画像はそのあとどうなる？</h4>
            <p>
              ブラウザの中の一時メモリで処理して<strong>終わったら消えます</strong>。どこのサーバーにも保存されません。
              結果（テキスト等）は、<strong>あなたが保存したものがあなたのPCの中に置かれるだけ</strong>です。
            </p>

            <h4>画像処理プログラムの保存先</h4>
            <p>
              最初に読み込む画像処理プログラム（約180MB）は、<strong>あなたのPCの中（ブラウザのこのサイト専用の保存領域）</strong>に保存されます。
              次回からは再ダウンロード不要で、オフラインでも使えます。不要になればブラウザの「サイトデータを削除」で消せます。
            </p>

            <h4>だから役所でも安心</h4>
            <p>
              個人情報や行政文書を<strong>外部に送らない</strong>＝いわゆる「情報の持ち出し」に当たりません。
              クラウドに上げないので、送信中・預け先での漏えいリスクがそもそも発生しません。
              ソースコードも公開されており検証できます。
            </p>

            <p className="muted">※「ページを開く」「初回に画像処理プログラムを取り込む」ときだけ、ふつうのWeb閲覧と同じ通信が起きます（＝道具が届く通信）。これは画像とは無関係です。</p>

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
