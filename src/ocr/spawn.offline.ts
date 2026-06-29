// Worker生成＋init payload — オフラインHTML版（file:// 直開きで動く）
// - inline(blob) classic Worker: file:// では type=module / 別ファイルWorker が読めないため。
// - モデル/charset/wasm は埋め込み base64(self.__OCR_EMBED__) をバイト列に復号して渡す（fetch不可のため）。
import OfflineWorker from './worker?worker&inline'
import type { InitPayload } from './spawn'

// data: URL を fetch するとブラウザがネイティブに base64 デコードする（file:// でも可・atobより高速/省メモリ）。
async function decode(b64: string | undefined): Promise<ArrayBuffer> {
  if (!b64) throw new Error('埋め込みアセットが見つかりません（embed の読み込み順を確認）')
  const res = await fetch('data:application/octet-stream;base64,' + b64)
  return await res.arrayBuffer()
}

export function spawnWorker(): Worker {
  return new OfflineWorker()
}

export async function buildInit(): Promise<InitPayload> {
  const E = (globalThis as unknown as { __OCR_EMBED__?: Record<string, string> }).__OCR_EMBED__ || {}
  // 逐次デコード＋逐次解放: Promise.all で並行にすると6本分の data:URL 文字列(計約245MB)と
  // 元 base64(計約245MB)と生成中 ArrayBuffer が一過性に並存し、低RAMの庁内PCでメモリ圧迫(最悪600MB超)。
  // 1本ずつ復号し、復号した端から元 base64 を解放することでピークを約300MB前後に抑える。
  const keys = ['wasm', 'charset', 'deim', 'parseq30', 'parseq50', 'parseq100'] as const
  const buf: Record<string, ArrayBuffer> = {}
  for (const k of keys) {
    buf[k] = await decode(E[k])
    ;(E as Record<string, string | undefined>)[k] = undefined // 元 base64 を即解放(GC対象に)
  }
  ;(globalThis as unknown as { __OCR_EMBED__?: unknown }).__OCR_EMBED__ = undefined
  const models: Record<string, ArrayBuffer> = {
    'deim.onnx': buf.deim, 'parseq30.onnx': buf.parseq30, 'parseq50.onnx': buf.parseq50, 'parseq100.onnx': buf.parseq100,
  }
  return {
    msg: { type: 'init', bytes: { charset: buf.charset, models }, wasmBinary: buf.wasm },
    transfer: [buf.wasm, buf.charset, buf.deim, buf.parseq30, buf.parseq50, buf.parseq100],
  }
}
