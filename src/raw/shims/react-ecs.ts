import { createElement, setUiRenderer } from '../ui.ts'

export const UiEntity = 'UiEntity'
export const Label = 'Label'
export const Input = 'Input'
export const ReactEcsRenderer = { setUiRenderer }
const ReactEcs = { createElement }
export { ReactEcs }
export default ReactEcs
