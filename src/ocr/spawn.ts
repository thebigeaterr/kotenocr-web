// Worker生成＋init payload — web / Tauri 版（ESモジュールWorker、モデルはbaseからfetch）
// オフラインHTML版は spawn.offline.ts（vite alias `@spawn` で切替）。

export interface InitPayload { msg: Record<string, unknown>; transfer: Transferable[] }

export function spawnWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

export async function buildInit(): Promise<InitPayload> {
  return { msg: { type: 'init', base: import.meta.env.BASE_URL }, transfer: [] }
}
