import { __raw, engine } from './shims/ecs.ts'
import { IDS } from './protocol.ts'
import { uiBackground, uiInput, uiText, uiTransform } from './ui-values.ts'

type Entity = number
type Props = Record<string, any>
type UiNode = { type: any; props: Props }
type KnownNode = { type: any; entity: Entity }
type InputHandlers = {
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
}
type UiOptions = {
  virtualWidth: number
  virtualHeight: number
  version?: () => unknown
}

const oldNodes = new Map<string, KnownNode>()
const clickHandlers = new Map<Entity, () => void>()
const inputHandlers = new Map<Entity, InputHandlers>()
const listenedClicks = new Set<Entity>()
const listenedInputs = new Set<Entity>()
let renderer: (() => any) | undefined
let options: UiOptions = { virtualWidth: 1920, virtualHeight: 1080 }
let lastVersion: unknown
let lastScale: number | undefined

function flat(children: any, output: any[] = []): any[] {
  for (const child of children ?? []) {
    if (Array.isArray(child)) flat(child, output)
    else if (child !== null && child !== undefined && child !== false && child !== true) output.push(child)
  }
  return output
}

export function createElement(type: any, props: Props | undefined, ...children: any[]): any {
  const next = { ...(props ?? {}), children: flat(children) }
  if (typeof type === 'function') return type(next)
  return { type, props: next }
}

function canvasScale(): number {
  const canvas = __raw.getComponent(IDS.UiCanvasInformation).getOrNull(engine.RootEntity)
  if (!canvas?.width || !canvas?.height) return 1
  return Math.min(canvas.width / options.virtualWidth, canvas.height / options.virtualHeight)
}

function setOrDelete(id: number, entity: Entity, value: any): void {
  const component = __raw.getComponent(id)
  if (value === undefined) {
    if (component.has(entity)) component.deleteFrom(entity)
  } else __raw.setIfChanged(component, entity, value)
}

function listenForClick(entity: Entity): void {
  if (listenedClicks.has(entity)) return
  listenedClicks.add(entity)
  __raw.getComponent(IDS.PointerEventsResult).onChange(entity, (event: any) => {
    if (event?.button === 0 && event.state === 1) clickHandlers.get(entity)?.()
  })
}

function listenForInput(entity: Entity): void {
  if (listenedInputs.has(entity)) return
  listenedInputs.add(entity)
  __raw.getComponent(IDS.UiInputResult).onChange(entity, (event: any) => {
    if (!event) return
    const handlers = inputHandlers.get(entity)
    if (event.isSubmit) handlers?.onSubmit?.(event.value)
    handlers?.onChange?.(event.value)
  })
}

function forgetNode(entity: Entity): void {
  engine.removeEntity(entity)
  clickHandlers.delete(entity)
  inputHandlers.delete(entity)
  listenedClicks.delete(entity)
  listenedInputs.delete(entity)
}

function applyNode(node: UiNode, entity: Entity, parent: Entity, rightOf: Entity, scale: number): void {
  const props = node.props
  setOrDelete(IDS.UiTransform, entity, uiTransform(props.uiTransform, parent, rightOf, scale))
  setOrDelete(IDS.UiBackground, entity, props.uiBackground === undefined ? undefined : uiBackground(props.uiBackground))
  if (node.type === 'Label') setOrDelete(IDS.UiText, entity, uiText(props, scale))
  else setOrDelete(IDS.UiText, entity, undefined)
  if (node.type === 'Input') {
    setOrDelete(IDS.UiInput, entity, uiInput(props, scale))
    inputHandlers.set(entity, { onChange: props.onChange, onSubmit: props.onSubmit })
    listenForInput(entity)
  } else {
    setOrDelete(IDS.UiInput, entity, undefined)
    inputHandlers.delete(entity)
  }
  if (props.onMouseDown) {
    clickHandlers.set(entity, props.onMouseDown)
    setOrDelete(IDS.PointerEvents, entity, {
      pointerEvents: [{
        eventType: 1,
        eventInfo: { button: 0, showFeedback: true },
        interactionType: 0
      }]
    })
    listenForClick(entity)
  } else {
    clickHandlers.delete(entity)
    setOrDelete(IDS.PointerEvents, entity, undefined)
  }
}

function visit(
  node: UiNode | null | undefined,
  path: string,
  parent: Entity,
  rightOf: Entity,
  active: Set<string>,
  scale: number
): Entity {
  if (!node || Array.isArray(node)) return rightOf
  let known = oldNodes.get(path)
  if (!known || known.type !== node.type) {
    if (known) forgetNode(known.entity)
    known = { type: node.type, entity: engine.addEntity() }
    oldNodes.set(path, known)
  }
  active.add(path)
  applyNode(node, known.entity, parent, rightOf, scale)
  let prior = 0
  const children = flat(node.props.children)
  for (let index = 0; index < children.length; index++)
    prior = visit(children[index], `${path}.${index}`, known.entity, prior, active, scale)
  return known.entity
}

export function renderUi(): void {
  if (!renderer) return
  const scale = canvasScale()
  const version = options.version?.()
  if (options.version && version === lastVersion && scale === lastScale) return
  const active = new Set<string>()
  const roots: UiNode[] = [{
    type: 'UiEntity',
    props: {
      uiTransform: { positionType: 'absolute', position: { top: 0, left: 0, right: 0, bottom: 0 } },
      children: flat([renderer()])
    }
  }]
  let prior = 0
  for (let index = 0; index < roots.length; index++)
    prior = visit(roots[index], `${index}`, 0, prior, active, scale)
  for (const [path, node] of [...oldNodes]) {
    if (active.has(path)) continue
    forgetNode(node.entity)
    oldNodes.delete(path)
  }
  lastVersion = options.version?.()
  lastScale = scale
}

export function setUiRenderer(value: () => any, valueOptions?: Partial<UiOptions>): void {
  renderer = value
  options = { ...options, ...(valueOptions ?? {}) }
  lastVersion = undefined
  lastScale = undefined
}
