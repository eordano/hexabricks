import { engine, Transform } from './raw/shims/ecs.ts'
import { Color4 } from './raw/shims/math.ts'
import players from './raw/shims/players.ts'
import { OPEN_BUILD } from './access-config.ts'
import ReactEcs, { Input, Label, ReactEcsRenderer, UiEntity } from './raw/shims/react-ecs.ts'
import * as Core from './hexbrick-core'
import {
  ACTIONS,
  cyclePossiblePlacement,
  doRotate,
  redo,
  selectColor,
  selectBlockHeight,
  selectShape,
  setRememberRotation,
  setAction,
  state,
  undo,
  undoDepth
} from './game'
import { BLOCK_HEIGHTS, FLOOR_D, FLOOR_W } from './scene-config.ts'
import { COLORS, hexToColor4 } from './palette'
import {
  buildersList,
  invitablePlayers,
  lastNotice,
  layEvents,
  nameOf,
  persistenceRevision,
  requestBan,
  requestInvite
} from './persistence'

const RUBY = hexToColor4('#FF2D55')
const RUBY_FAINT = hexToColor4('#FF2D55', 0.22)
const SILVER = hexToColor4('#A09BA8')
const SNOW = hexToColor4('#FCFCFC')
const GREEN = hexToColor4('#30CD00')
const RED = hexToColor4('#E00000')
const YELLOW = hexToColor4('#FFBC5B')
const RING_DARK = hexToColor4('#161518')
const WHITE = (a: number) => Color4.create(1, 1, 1, a)
type Color = ReturnType<typeof Color4.create>
const FILL = { width: '100%', height: '100%' }
const OVERLAY = { ...FILL, positionType: 'absolute', position: { top: 0, left: 0 } }
const CENTER = { alignItems: 'center', justifyContent: 'center' }
const swatch = (i: number) => hexToColor4(COLORS[i].base)
const Text = (p: Record<string, unknown>) => <Label color={SNOW} textAlign="middle-center" {...p} />
const TextL = (p: Record<string, unknown>) => <Text textAlign="middle-left" {...p} />

function nine(src: string, color?: Color, slice?: number) {
  return {
    textureMode: 'nine-slices' as const,
    texture: { src: `images/hud/${src}` },
    ...(slice !== undefined
      ? { textureSlices: { top: slice, right: slice, bottom: slice, left: slice } }
      : {}),
    ...(color ? { color } : {})
  }
}
const CAPS = 0.49
const icon = (i: number, color: Color) => ({ texture: { src: `images/icons/icon-${i}.png` }, textureMode: 'stretch', color })

type Period = 'day' | 'week' | 'month' | 'sinceLastVisit'
const PERIODS: Array<{ key: Period; label: string; ms: number | null }> = [
  { key: 'day', label: 'Today', ms: 86400e3 },
  { key: 'week', label: 'Week', ms: 6048e5 },
  { key: 'month', label: 'Month', ms: 2592e6 },
  { key: 'sinceLastVisit', label: 'New', ms: null }
]
const SESSION_START = Date.now()
const WELCOME_DELAY_MS = 4000
const connected = new Set<string>()
let presenceRevision = 0
players.onEnterScene((p) => {
  connected.add(p.userId.toLowerCase())
  presenceRevision++
})
players.onLeaveScene((id) => {
  connected.delete(id.toLowerCase())
  presenceRevision++
})
const hud = {
  barMin: false,
  panelOpen: false,
  welcomeDismissed: false,
  welcomeInsideSince: 0,
  period: 'day' as Period,
  toastMsg: '',
  toastUntil: 0
}
function toast(msg: string) {
  hud.toastMsg = msg
  hud.toastUntil = Date.now() + 1800
}
function periodCutoff(): number {
  const p = PERIODS.find((p) => p.key === hud.period)!
  if (p.ms !== null) return Date.now() - p.ms
  return SESSION_START
}
function agoLabel(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`
  return `${Math.round(s / 86400)} days ago`
}

function playerInsideScene(): boolean {
  const position = Transform.getOrNull(engine.PlayerEntity)?.position
  return position !== undefined && position.x >= 0 && position.x <= FLOOR_W &&
    position.z >= 0 && position.z <= FLOOR_D
}

function welcomeVisible(now = Date.now(), inside = playerInsideScene()): boolean {
  if (hud.welcomeDismissed) return false
  if (!inside) {
    hud.welcomeInsideSince = 0
    return false
  }
  if (hud.welcomeInsideSince === 0) hud.welcomeInsideSince = now
  return now - hud.welcomeInsideSince >= WELCOME_DELAY_MS
}

function uiVersion(): string {
  const now = Date.now()
  const inside = playerInsideScene()
  return [
    state.sel, state.rot, state.ghostRot, state.color, state.thick,
    state.rememberRotation, state.count, state.action, undoDepth(),
    persistenceRevision(), presenceRevision, hud.barMin, hud.panelOpen, hud.period,
    inside, welcomeVisible(now, inside), hud.toastUntil > now, now >= rowsCacheUntil,
    hud.toastMsg, lastNotice()
  ].join('|')
}

interface Row {
  addr: string
  name: string
  host: boolean
  online: boolean
  invited: boolean
  count: number
}
function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a
}
type Rows = { rows: Row[]; online: number; meHost: boolean }
let rowsCache: { key: string; rows: Rows } | null = null
let rowsCacheUntil = 0
function builderRows(): Rows {
  const now = Date.now()
  const key = `${hud.period}|${persistenceRevision()}|${presenceRevision}`
  if (rowsCache && now < rowsCacheUntil && rowsCache.key === key) return rowsCache.rows
  rowsCacheUntil = now + 60_000
  rowsCache = { key, rows: computeRows() }
  return rowsCache.rows
}
function computeRows(): Rows {
  const cutoff = periodCutoff()
  const counts = new Map<string, number>()
  for (const e of layEvents()) {
    if (e.at < cutoff) continue
    const k = e.by.toLowerCase()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const row = (addr: string, host: boolean, invited: boolean): Row => ({
    addr, host, invited,
    name: nameOf(addr) ?? shortAddr(addr),
    online: connected.has(addr),
    count: counts.get(addr) ?? 0
  })
  const rows = buildersList().map((b) => row(b.addr, b.invitedBy === '', b.name === '' && !(counts.get(b.addr) ?? 0)))
  if (OPEN_BUILD)
    for (const addr of counts.keys())
      if (!rows.some((r) => r.addr === addr)) rows.push(row(addr, false, false))
  rows.sort((a, b) => b.count - a.count)
  const me = (players.getPlayer()?.userId ?? '').toLowerCase()
  return {
    rows,
    online: OPEN_BUILD ? connected.size : rows.filter((r) => r.online).length,
    meHost: rows.some((r) => r.addr === me && r.host)
  }
}

function Keycap(props: { k: string }) {
  return (
    <UiEntity
      uiTransform={{ width: 18, height: 18, margin: { left: 6 } }}
      uiBackground={nine('rect5.png', WHITE(0.14))}
    >
      <Text value={props.k} fontSize={11} uiTransform={FILL} />
    </UiEntity>
  )
}
function ActionBtn(props: { label: string; k?: string; selected?: boolean; onClick: () => void }) {
  return (
    <UiEntity
      uiTransform={{
        height: 34,
        width: 'auto',
        margin: { left: 6 },
        padding: { left: 12, right: 12 },
        flexDirection: 'row',
        alignItems: 'center'
      }}
      uiBackground={nine('rect12.png', props.selected ? RUBY_FAINT : WHITE(0.08))}
      onMouseDown={props.onClick}
    >
      <Text value={props.label} fontSize={12} />
      {props.k ? <Keycap k={props.k} /> : null}
    </UiEntity>
  )
}

function ShapeTile(props: { i: number }) {
  const selected = state.sel === props.i
  return (
    <UiEntity
      uiTransform={{ width: 58, height: 72, margin: 2, flexDirection: 'column', alignItems: 'center' }}
    >
      <UiEntity
        uiTransform={{ width: 54, height: 54 }}
        uiBackground={nine('rect12.png', selected ? RUBY_FAINT : WHITE(0.06))}
        onMouseDown={() => selectShape(props.i)}
      >
        <UiEntity uiTransform={{ ...FILL, padding: 8 }} uiBackground={selected ? nine('ring12.png', RUBY) : undefined}>
          <UiEntity uiTransform={FILL} uiBackground={icon(props.i, swatch(state.color))} />
        </UiEntity>
      </UiEntity>
      <Text
        value={Core.SHAPES[props.i].name.toUpperCase()}
        fontSize={10}
        color={selected ? SNOW : SILVER}
        uiTransform={{ width: 58, height: 14 }}
      />
    </UiEntity>
  )
}
function ShapeArrow(props: { glyph: string; k: string; onClick: () => void }) {
  const isWord = props.glyph.length > 1
  return (
    <UiEntity
      uiTransform={{ width: isWord ? 54 : 34, height: 54, margin: 2, flexDirection: 'column', ...CENTER }}
      uiBackground={nine('rect12.png', WHITE(0.06))}
      onMouseDown={props.onClick}
    >
      <Text value={props.glyph} fontSize={isWord ? 11 : 16} uiTransform={{ width: '100%', height: 22 }} />
      <Text value={props.k} fontSize={10} color={SILVER} />
    </UiEntity>
  )
}
function PaintSwatch(props: { i: number }) {
  const selected = state.color === props.i
  return (
    <UiEntity
      uiTransform={{ width: 38, height: 38, margin: 3 }}
      uiBackground={nine('rect8.png', swatch(props.i))}
      onMouseDown={() => selectColor(props.i)}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 9,
          positionType: 'absolute',
          position: { bottom: 3 },
          padding: { left: 3, right: 3 }
        }}
      >
        <UiEntity uiTransform={FILL} uiBackground={nine('rect5.png', hexToColor4(COLORS[props.i].glow))} />
      </UiEntity>
      {selected ? <UiEntity uiTransform={OVERLAY} uiBackground={nine('ring8.png', SNOW)} /> : null}
    </UiEntity>
  )
}
function ModeSeg() {
  return (
    <UiEntity
      uiTransform={{ height: 34, flexDirection: 'row', alignItems: 'center', padding: 3 }}
      uiBackground={nine('rect12.png', WHITE(0.06))}
    >
      {ACTIONS.map((label, i) => {
        const selected = state.action === i
        return (
          <UiEntity
            uiTransform={{ height: 28, padding: { left: 10, right: 10 }, alignItems: 'center' }}
            uiBackground={
              selected ? nine('rect12.png', label === 'Delete' ? RED : RUBY) : undefined
            }
            onMouseDown={() => setAction(i)}
          >
            <Text value={label} fontSize={12} color={selected ? SNOW : SILVER} />
          </UiEntity>
        )
      })}
      <Keycap k="F" />
    </UiEntity>
  )
}
function HeightSeg() {
  return (
    <UiEntity
      uiTransform={{ height: 34, flexDirection: 'row', alignItems: 'center', padding: 3, margin: { left: 6 } }}
      uiBackground={nine('rect12.png', WHITE(0.06))}
    >
      <Text value="HEIGHT" fontSize={10} color={SILVER} uiTransform={{ margin: { left: 7, right: 5 } }} />
      {BLOCK_HEIGHTS.map((thick, i) => {
        const selected = state.thick === thick
        return (
          <UiEntity
            uiTransform={{ width: 34, height: 28, alignItems: 'center' }}
            uiBackground={selected ? nine('rect12.png', RUBY) : undefined}
            onMouseDown={() => selectBlockHeight(thick)}
          >
            <Text value={`${i + 1}x`} fontSize={12} color={selected ? SNOW : SILVER} />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}
function Divider() {
  return (
    <UiEntity uiTransform={{ width: '100%', height: 1 }} uiBackground={{ color: WHITE(0.1) }} />
  )
}
function BuildBar() {
  return (
    <UiEntity
      uiTransform={{
        width: 'auto',
        height: 'auto',
        flexDirection: 'column',
        alignItems: 'center',
        padding: { top: 6, left: 16, right: 16, bottom: 14 }
      }}
      uiBackground={nine('panel62.png')}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 16, justifyContent: 'center' }}
        onMouseDown={() => (hud.barMin = true)}
      >
        <Text value="v" fontSize={12} color={SILVER} />
      </UiEntity>

      <UiEntity uiTransform={{ width: 'auto', height: 76, flexDirection: 'row', alignItems: 'flex-start', margin: { bottom: 10 } }}>
        <ShapeArrow glyph="FIT" k="1" onClick={cyclePossiblePlacement} />
        {Core.SHAPES.map((_, i) => (
          <ShapeTile i={i} />
        ))}
        <ShapeArrow glyph=">" k="3" onClick={() => selectShape(state.sel + 1)} />
      </UiEntity>
      <Divider />

      <UiEntity uiTransform={{ width: 'auto', height: 44, flexDirection: 'row', margin: { top: 10, bottom: 10 } }}>
        {COLORS.map((_, i) => (
          <PaintSwatch i={i} />
        ))}
      </UiEntity>
      <Divider />

      <UiEntity
        uiTransform={{ width: 'auto', height: 40, flexDirection: 'row', alignItems: 'center', margin: { top: 10 } }}
      >
        <ModeSeg />
        <HeightSeg />
        <UiEntity uiTransform={{ width: 1, height: 26, margin: { left: 10, right: 4 } }} uiBackground={{ color: WHITE(0.1) }} />
        <ActionBtn
          label={
            state.ghostRot !== null && state.ghostRot !== state.rot
              ? `Rotate ${state.rot * 60} > ${state.ghostRot * 60}`
              : `Rotate ${state.rot * 60}`
          }
          k="2"
          onClick={doRotate}
        />
        <ActionBtn
          label={`Remember rotation: ${state.rememberRotation ? 'On' : 'Off'}`}
          selected={state.rememberRotation}
          onClick={() => setRememberRotation(!state.rememberRotation)}
        />
        <ActionBtn label={`Undo (${undoDepth()})`} k="4" onClick={undo} />
        <ActionBtn label="Redo" onClick={redo} />
      </UiEntity>

    </UiEntity>
  )
}
function BuildPill() {
  return (
    <UiEntity
      uiTransform={{
        width: 'auto',
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        padding: { left: 14, right: 14 }
      }}
      uiBackground={nine('caps85.png', undefined, CAPS)}
      onMouseDown={() => (hud.barMin = false)}
    >
      <UiEntity uiTransform={{ width: 22, height: 22, margin: { right: 8 } }} uiBackground={icon(state.sel, swatch(state.color))} />
      <UiEntity uiTransform={{ width: 14, height: 14, margin: { right: 8 } }} uiBackground={nine('rect5.png', swatch(state.color))} />
      <Text value="Build" fontSize={14} />
      <Text value="^" fontSize={12} color={SILVER} uiTransform={{ width: 16, height: 16, margin: { left: 6 } }} />
    </UiEntity>
  )
}

function AvatarDot(props: { addr: string; size: number; online?: boolean }) {
  return (
    <UiEntity uiTransform={{ width: props.size, height: props.size }}>
      <UiEntity uiTransform={FILL} uiBackground={nine('circle.png', WHITE(0.18), CAPS)} />
      {props.addr ? (
        <UiEntity uiTransform={OVERLAY} uiBackground={{ textureMode: 'stretch', avatarTexture: { userId: props.addr } }} />
      ) : null}
      <UiEntity uiTransform={OVERLAY} uiBackground={nine('circlering.png', RING_DARK, CAPS)} />
      {props.online ? (
        <UiEntity
          uiTransform={{ width: 9, height: 9, positionType: 'absolute', position: { bottom: 0, right: 0 } }}
          uiBackground={nine('circle.png', GREEN, CAPS)}
        />
      ) : null}
    </UiEntity>
  )
}
function BuildersRail() {
  const { rows, online } = builderRows()
  return (
    <UiEntity
      uiTransform={{
        width: 56,
        height: 'auto',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 10
      }}
      uiBackground={nine('caps85.png', undefined, CAPS)}
      onMouseDown={() => (hud.panelOpen = true)}
    >
      <Text value="<" fontSize={14} color={SILVER} uiTransform={{ width: 16, height: 18 }} />
      {rows.slice(0, 3).map((r, i) => (
        <UiEntity uiTransform={{ width: 30, height: 30, margin: { top: i === 0 ? 2 : -8 } }}>
          <AvatarDot addr={r.addr} size={30} />
        </UiEntity>
      ))}
      <UiEntity uiTransform={{ width: 24, height: 18, margin: { top: 6 }, ...CENTER }} uiBackground={nine('rect8.png', GREEN)}>
        <Text value={`${online}`} fontSize={11} color={RING_DARK} />
      </UiEntity>
    </UiEntity>
  )
}
let inviteDraft = ''
function submitInvite(target: string) {
  if (target) requestInvite(target)
}
function BuilderRowUi(props: { r: Row; max: number; canRevoke: boolean }) {
  const { r, max } = props
  return (
    <UiEntity uiTransform={{ width: '100%', height: 46, flexDirection: 'row', alignItems: 'center', margin: { bottom: 6 } }}>
      <AvatarDot addr={r.addr} size={36} online={r.online} />
      <UiEntity uiTransform={{ width: 160, height: '100%', flexDirection: 'column', margin: { left: 10 }, justifyContent: 'center' }}>
        <UiEntity uiTransform={{ width: '100%', height: 18, flexDirection: 'row', alignItems: 'center' }}>
          <TextL value={r.name} fontSize={14} />
          {r.host ? (
            <UiEntity uiTransform={{ width: 42, height: 15, margin: { left: 6 }, ...CENTER }} uiBackground={nine('chiphost.png')}>
              <Text value="HOST" fontSize={9} />
            </UiEntity>
          ) : r.invited ? (
            <UiEntity uiTransform={{ width: 54, height: 15, margin: { left: 6 }, ...CENTER }} uiBackground={nine('ring8.png', YELLOW)}>
              <Text value="INVITED" fontSize={9} color={YELLOW} />
            </UiEntity>
          ) : null}
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: 3, margin: { top: 5 } }} uiBackground={{ color: WHITE(0.08) }}>
          <UiEntity
            uiTransform={{ width: `${max ? Math.round((r.count / max) * 100) : 0}%`, height: 3 }}
            uiBackground={nine('progress.png')}
          />
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ width: 64, height: '100%', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
        <Text value={`${r.count}`} fontSize={15} textAlign="middle-right" />
        <Text value="BRICKS" fontSize={9} color={SILVER} textAlign="middle-right" />
      </UiEntity>
      {props.canRevoke ? (
        <UiEntity
          uiTransform={{ width: 20, height: 20, margin: { left: 8 }, ...CENTER }}
          onMouseDown={() => {
            requestBan(r.addr)
            toast(`${r.name} can no longer lay bricks`)
          }}
        >
          <Text value="x" fontSize={12} color={WHITE(0.35)} />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}
function BuildersCard() {
  const { rows, online, meHost } = builderRows()
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0)
  const nearby = canInviteHere(meHost) ? invitablePlayers() : []
  return (
    <UiEntity
      uiTransform={{
        width: 340,
        height: 'auto',
        flexDirection: 'column',
        padding: 18
      }}
      uiBackground={nine('panel72.png')}
    >
      <UiEntity uiTransform={{ width: '100%', height: 26, flexDirection: 'row', alignItems: 'center', margin: { bottom: 14 } }}>
        <TextL value="Builders" fontSize={18} />
        <TextL
          value={OPEN_BUILD ? `  public build | ${online} online` : `  ${rows.length} authorized | ${online} online`}
          fontSize={12}
          color={SILVER}
          uiTransform={{ width: 160, height: '100%' }}
        />
        <UiEntity
          uiTransform={{ width: 24, height: 24, positionType: 'absolute', position: { right: 0 }, ...CENTER }}
          uiBackground={nine('circle.png', WHITE(0.1), CAPS)}
          onMouseDown={() => (hud.panelOpen = false)}
        >
          <Text value=">" fontSize={13} />
        </UiEntity>
      </UiEntity>

      <UiEntity uiTransform={{ width: '100%', height: 30, flexDirection: 'row', padding: 3, margin: { bottom: 6 } }} uiBackground={nine('rect12.png', WHITE(0.06))}>
        {PERIODS.map((p) => (
          <UiEntity
            uiTransform={{ width: `${100 / PERIODS.length}%`, height: 24, ...CENTER }}
            uiBackground={hud.period === p.key ? nine('rect12.png', RUBY) : undefined}
            onMouseDown={() => (hud.period = p.key)}
          >
            <Text value={p.label} fontSize={11} color={hud.period === p.key ? SNOW : SILVER} />
          </UiEntity>
        ))}
      </UiEntity>
      {hud.period === 'sinceLastVisit' ? (
        <TextL
          value={`Bricks laid since your last visit | ${agoLabel(periodCutoff())}`}
          fontSize={10}
          color={SILVER}
          uiTransform={{ width: '100%', height: 14, margin: { bottom: 6 } }}
        />
      ) : null}

      <UiEntity uiTransform={{ width: '100%', height: 'auto', flexDirection: 'column', margin: { top: 8 } }}>
        {rows.map((r) => (
          <BuilderRowUi r={r} max={max} canRevoke={!OPEN_BUILD && !r.host && meHost} />
        ))}
      </UiEntity>

      {nearby.length > 0 ? (
        <UiEntity uiTransform={{ width: '100%', height: 'auto', flexDirection: 'column', margin: { top: 10 } }}>
          <TextL value="HERE NOW" fontSize={9} color={SILVER} uiTransform={{ width: '100%', height: 12, margin: { bottom: 4 } }} />
          {nearby.slice(0, 4).map((p) => (
            <UiEntity uiTransform={{ width: '100%', height: 32, flexDirection: 'row', alignItems: 'center', margin: { bottom: 4 } }}>
              <AvatarDot addr={p.addr} size={24} online={true} />
              <TextL value={p.name} fontSize={12} uiTransform={{ width: 190, height: '100%', margin: { left: 8 } }} />
              <InviteButton width={66} height={26} fontSize={11} onClick={() => requestInvite(p.addr)} />
            </UiEntity>
          ))}
        </UiEntity>
      ) : null}

      {canInviteHere(meHost) ? (
        <UiEntity uiTransform={{ width: '100%', height: 'auto', flexDirection: 'column', margin: { top: 10 } }}>
          <UiEntity uiTransform={{ width: '100%', height: 36, flexDirection: 'row' }}>
            <UiEntity uiTransform={{ width: 220, height: 36 }} uiBackground={nine('rect12.png', WHITE(0.08))}>
              <Input
                onChange={(v: string) => (inviteDraft = v)}
                onSubmit={submitInvite}
                placeholder="Invite by name or address"
                placeholderColor={SILVER}
                fontSize={12}
                color={SNOW}
                uiTransform={{ width: '100%', height: '100%', padding: { left: 10 } }}
              />
            </UiEntity>
            <InviteButton width={76} height={36} fontSize={13} margin={{ left: 8 }} onClick={() => submitInvite(inviteDraft)} />
          </UiEntity>
          <TextL
            value="Invite nearby builders by name or wallet address."
            fontSize={10}
            color={SILVER}
            uiTransform={{ width: '100%', height: 14, margin: { top: 6 } }}
          />
        </UiEntity>
      ) : null}
      {OPEN_BUILD ? (
        <TextL
          value="Public build is temporarily enabled. Genesis work is saved by the persistence server."
          fontSize={10}
          color={SILVER}
          uiTransform={{ width: '100%', height: 28, margin: { top: 10 } }}
        />
      ) : null}
    </UiEntity>
  )
}
function InviteButton(props: { width: number; height: number; fontSize: number; margin?: object; onClick: () => void }) {
  return (
    <UiEntity
      uiTransform={{ width: props.width, height: props.height, ...(props.margin ? { margin: props.margin } : {}), ...CENTER }}
      uiBackground={nine('rect12.png', RUBY)}
      onMouseDown={props.onClick}
    >
      <Text value="Invite" fontSize={props.fontSize} />
    </UiEntity>
  )
}
function canInviteHere(meHost: boolean): boolean {
  const me = (players.getPlayer()?.userId ?? '').toLowerCase()
  return meHost || buildersList().some((b) => b.addr === me)
}

function Counter() {
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 24, right: 24 }, width: 120, height: 62, flexDirection: 'column', ...CENTER }}
      uiBackground={nine('panel72.png')}
    >
      <Text value={`${state.count}`} fontSize={24} color={RUBY} uiTransform={{ width: '100%', height: 30 }} />
      <Text value="BRICKS" fontSize={10} color={SILVER} uiTransform={{ width: '100%', height: 14 }} />
    </UiEntity>
  )
}
function Toast() {
  if (hud.toastUntil === 0) return null
  if (Date.now() >= hud.toastUntil) {
    hud.toastUntil = 0
    return null
  }
  return (
    <UiEntity
      uiTransform={{ width: 'auto', height: 34, padding: { left: 16, right: 16 }, ...CENTER }}
      uiBackground={nine('caps85.png', undefined, CAPS)}
    >
      <Text value={hud.toastMsg} fontSize={13} />
    </UiEntity>
  )
}

function WelcomeScreen() {
  if (!welcomeVisible()) return null
  const dismiss = () => { hud.welcomeDismissed = true }
  return (
    <UiEntity
      uiTransform={{ ...OVERLAY, ...CENTER }}
      uiBackground={{ color: Color4.create(0.086, 0.082, 0.094, 0.76) }}
    >
      <UiEntity
        uiTransform={{
          width: 520,
          height: 392,
          padding: { top: 34, right: 42, bottom: 30, left: 42 },
          flexDirection: 'column',
          alignItems: 'center'
        }}
        uiBackground={nine('panel72.png')}
      >
        <UiEntity
          uiTransform={{ width: 68, height: 68, padding: 10, margin: { bottom: 18 } }}
          uiBackground={nine('rect12.png', RUBY_FAINT)}
        >
          <UiEntity uiTransform={FILL} uiBackground={icon(0, RUBY)} />
        </UiEntity>
        <Text value="Welcome to Hexabricks" fontSize={28} uiTransform={{ width: '100%', height: 38 }} />
        <Text
          value="A place for builders to gather and explore the patterns that hexagonal shapes generate. Creations are persisted on future deployments as well as in a server. Have fun! A scene by @eordano"
          fontSize={16}
          color={SILVER}
          uiTransform={{ width: '100%', height: 126, margin: { top: 8, bottom: 22 } }}
        />
        <UiEntity uiTransform={{ width: 190, height: 44, ...CENTER }} uiBackground={nine('rect12.png', RUBY)} onMouseDown={dismiss}>
          <Text value="Start building" fontSize={15} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

let seenNotice = ''
function HexbricksUi() {
  const notice = lastNotice()
  if (notice && notice !== seenNotice) {
    seenNotice = notice
    toast(notice)
  }
  const row = (bottom: number) => ({
    positionType: 'absolute', position: { bottom, left: 0 }, width: '100%', height: 'auto', flexDirection: 'row', justifyContent: 'center'
  })
  return (
    <UiEntity uiTransform={FILL}>
      <Counter />
      <UiEntity uiTransform={row(28)}>{hud.barMin ? <BuildPill /> : <BuildBar />}</UiEntity>
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { right: 24, top: 0 }, width: 'auto', height: '100%', flexDirection: 'column', justifyContent: 'center' }}
      >
        {hud.panelOpen ? <BuildersCard /> : <BuildersRail />}
      </UiEntity>
      <UiEntity uiTransform={row(360)}><Toast /></UiEntity>
      <WelcomeScreen />
    </UiEntity>
  )
}

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(HexbricksUi, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    version: uiVersion
  })
}
