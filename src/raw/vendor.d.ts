declare module '@dcl/ecs/dist-cjs/components/generated/pb/decentraland/sdk/components/*.gen.js' {
  interface GeneratedCodec {
    encode(value: any): { finish(): Uint8Array }
    decode(data: Uint8Array): any
  }

  export const PBGltfContainer: GeneratedCodec
  export const PBGltfNodeModifiers: GeneratedCodec
  export const PBMaterial: GeneratedCodec
  export const PBMeshCollider: GeneratedCodec
  export const PBMeshRenderer: GeneratedCodec
  export const PBPointerEvents: GeneratedCodec
  export const PBPointerEventsResult: GeneratedCodec
  export const PBPointerLock: GeneratedCodec
  export const PBRaycast: GeneratedCodec
  export const PBRaycastResult: GeneratedCodec
  export const PBUiBackground: GeneratedCodec
  export const PBUiCanvasInformation: GeneratedCodec
  export const PBUiInput: GeneratedCodec
  export const PBUiInputResult: GeneratedCodec
  export const PBUiText: GeneratedCodec
  export const PBUiTransform: GeneratedCodec
}
