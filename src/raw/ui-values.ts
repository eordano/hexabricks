type Props = Record<string, any>
type NumberMap = Record<string, number>

const ALIGN: NumberMap = { auto: 0, 'flex-start': 1, center: 2, 'flex-end': 3, stretch: 4, baseline: 5, 'space-between': 6, 'space-around': 7 }
const JUSTIFY: NumberMap = { 'flex-start': 0, center: 1, 'flex-end': 2, 'space-between': 3, 'space-around': 4, 'space-evenly': 5 }
const DIRECTION: NumberMap = { row: 0, column: 1, 'column-reverse': 2, 'row-reverse': 3 }
const POSITION: NumberMap = { relative: 0, absolute: 1 }
const TEXT_ALIGN: NumberMap = { 'top-left': 0, 'top-center': 1, 'top-right': 2, 'middle-left': 3, 'middle-center': 4, 'middle-right': 5, 'bottom-left': 6, 'bottom-center': 7, 'bottom-right': 8 }
const FONT: NumberMap = { 'sans-serif': 0, serif: 1, monospace: 2 }
const TEXTURE_MODE: NumberMap = { 'nine-slices': 0, center: 1, stretch: 2 }

function unit(value: unknown, scale: number): [number, number] {
  if (typeof value === 'number') return [1, value * scale]
  if (value === 'auto') return [3, 0]
  if (typeof value === 'string' && value.endsWith('%')) return [2, Number(value.slice(0, -1))]
  return [0, 0]
}

function sides(value: unknown): Props {
  if (typeof value === 'number') return { left: value, top: value, right: value, bottom: value }
  return value && typeof value === 'object' ? value as Props : {}
}

function putUnit(output: Props, name: string, value: unknown, scale: number): void {
  const [kind, number] = unit(value, scale)
  output[`${name}Unit`] = kind
  output[name] = number
}

export function uiTransform(value: Props = {}, parent = 0, rightOf = 0, scale = 1): Props {
  const output: Props = {
    parent,
    rightOf,
    alignContent: value.alignContent === undefined ? undefined : ALIGN[value.alignContent],
    alignItems: value.alignItems === undefined ? undefined : ALIGN[value.alignItems],
    flexWrap: undefined,
    flexShrink: undefined,
    positionType: POSITION[value.positionType] ?? 0,
    alignSelf: ALIGN[value.alignSelf] ?? 0,
    flexDirection: DIRECTION[value.flexDirection] ?? 0,
    justifyContent: JUSTIFY[value.justifyContent] ?? 0,
    overflow: 0,
    display: 0,
    flexBasisUnit: 0,
    flexBasis: 0,
    flexGrow: value.flexGrow ?? 0,
    pointerFilter: 0,
    opacity: value.opacity ?? 1,
    zIndex: value.zIndex ?? 0
  }
  putUnit(output, 'width', value.width ?? 'auto', scale)
  putUnit(output, 'height', value.height, scale)
  for (const name of ['minWidth', 'minHeight', 'maxWidth', 'maxHeight']) putUnit(output, name, value[name], scale)
  const position = sides(value.position)
  const margin = sides(value.margin)
  const padding = sides(value.padding)
  for (const side of ['Left', 'Top', 'Right', 'Bottom']) {
    const key = side.toLowerCase()
    putUnit(output, `position${side}`, position[key], scale)
    putUnit(output, `margin${side}`, margin[key], scale)
    putUnit(output, `padding${side}`, padding[key], scale)
  }
  return output
}

function fontProps(props: Props, scale: number): Props {
  return {
    textAlign: props.textAlign === undefined ? undefined : TEXT_ALIGN[props.textAlign],
    font: props.font === undefined ? undefined : FONT[props.font],
    fontSize: props.fontSize === undefined ? undefined : Math.round(props.fontSize * scale)
  }
}

export function uiText(props: Props, scale = 1): Props {
  return {
    value: props.value ?? '',
    color: props.color,
    ...fontProps(props, scale),
    textWrap: props.textWrap === 'nowrap' ? 1 : 0
  }
}

export function uiBackground(value: Props = {}): Props {
  let texture
  if (value.texture) texture = { tex: { $case: 'texture', texture: value.texture } }
  else if (value.avatarTexture) texture = { tex: { $case: 'avatarTexture', avatarTexture: value.avatarTexture } }
  return {
    color: value.color,
    texture,
    textureMode: TEXTURE_MODE[value.textureMode] ?? 1,
    textureSlices: value.textureSlices,
    uvs: value.uvs ?? []
  }
}

export function uiInput(props: Props, scale = 1): Props {
  return {
    placeholder: props.placeholder ?? '',
    color: props.color,
    placeholderColor: props.placeholderColor,
    disabled: props.disabled ?? false,
    ...fontProps(props, scale),
    value: props.value
  }
}
