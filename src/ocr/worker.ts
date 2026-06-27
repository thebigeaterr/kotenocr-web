// OCR Web Worker — onnxruntime-web をUIスレッド外で実行
import * as ort from 'onnxruntime-web'
import { Pipeline } from './pipeline'

let pipe: Pipeline | null = null

function post(msg: unknown) { ;(self as unknown as Worker).postMessage(msg) }

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      // wasmはViteがバンドルした同一オリジンのアセットから自動ロード。
      // COOP/COEP無しのGitHub Pagesでも動くよう単一スレッド固定。
      ort.env.wasm.numThreads = 1
      pipe = new Pipeline(ort, msg.base)
      await pipe.load((p) => post({ type: 'progress', ...p }))
      post({ type: 'ready' })
    } else if (msg.type === 'run') {
      if (!pipe) throw new Error('not initialized')
      pipe.setCascade(msg.cascade !== false)
      const bmp = await createImageBitmap(msg.blob as Blob)
      const res = await pipe.run(bmp, (p) => post({ type: 'progress', ...p }))
      bmp.close()
      post({ type: 'result', result: res, jobId: msg.jobId })
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}` : String(err) })
  }
}
