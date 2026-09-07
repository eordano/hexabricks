import * as EngineApi from '~system/EngineApi'
import { main } from '../index.ts'
import { __raw } from './shims/ecs.ts'
import { __players } from './shims/players.ts'
import { renderUi } from './ui.ts'

let pending: Uint8Array[] = []
let started = false

async function exchange(data: Uint8Array): Promise<void> {
  const response = await EngineApi.crdtSendToRenderer({ data })
  pending = response.data ?? []
}

export async function onStart(): Promise<void> {
  __raw.beginFrame()
  const state = await EngineApi.crdtGetState({ data: new Uint8Array() })
  for (const chunk of state.data ?? []) __raw.applyChunk(chunk, 'state')
  void __players.preload()
  main()
  renderUi()
  started = true
  console.log('[hexabricks/raw] raw CRDT runtime started')
}

export async function onUpdate(deltaTime: number): Promise<void> {
  if (!started) return
  __raw.beginFrame()
  for (const chunk of pending) __raw.applyChunk(chunk)
  pending = []
  __raw.runSystems(deltaTime)
  renderUi()
  void __players.tick(deltaTime)
  await exchange(__raw.flush())
}

;(globalThis as any).__HEXABRICKS_RAW__ = {
  componentEntries: (id: number) => __raw.componentEntries(id)
}
