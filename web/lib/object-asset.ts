export type ObjectAssetManifestEntry = {
  level: number
  label: string
  file: string
  byteLength: number
  vertices: number
  triangles: number
  sha256: string
}

export type ObjectAssetManifest = {
  schemaVersion: 1
  asset: string
  lods: ObjectAssetManifestEntry[]
}

export type MeshGeometry = {
  positions: Array<[number, number, number]>
  indices: number[]
}

type GltfAccessor = {
  bufferView: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
}

type GltfBufferView = {
  buffer: number
  byteOffset?: number
  byteLength: number
}

type GltfDocument = {
  asset?: {version?: string}
  buffers?: Array<{byteLength: number; uri?: string}>
  bufferViews?: GltfBufferView[]
  accessors?: GltfAccessor[]
  meshes?: Array<{
    primitives?: Array<{
      attributes?: {POSITION?: number}
      indices?: number
      mode?: number
    }>
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0
}

export function parseObjectAssetManifest(text: string): ObjectAssetManifest {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.asset !== "string" || !Array.isArray(value.lods)) {
    throw new Error("invalid object asset manifest")
  }

  const lods = value.lods.map((entry, index): ObjectAssetManifestEntry => {
    if (
      !isRecord(entry) ||
      entry.level !== index ||
      typeof entry.label !== "string" ||
      typeof entry.file !== "string" ||
      !/^[a-z0-9-]+\.gltf$/.test(entry.file) ||
      !isPositiveInteger(entry.byteLength) ||
      !isPositiveInteger(entry.vertices) ||
      !isPositiveInteger(entry.triangles) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`invalid object asset manifest entry ${index}`)
    }

    return {
      level: entry.level as number,
      label: entry.label,
      file: entry.file,
      byteLength: entry.byteLength,
      vertices: entry.vertices,
      triangles: entry.triangles,
      sha256: entry.sha256,
    }
  })

  if (lods.length === 0) {
    throw new Error("object asset manifest must contain at least one LOD")
  }

  for (let index = 1; index < lods.length; index += 1) {
    if (lods[index].triangles <= lods[index - 1].triangles) {
      throw new Error("object asset LOD triangle counts must strictly increase")
    }
  }

  return {schemaVersion: 1, asset: value.asset, lods}
}

function decodeDataUri(uri: string) {
  const marker = ";base64,"
  const markerIndex = uri.indexOf(marker)
  if (!uri.startsWith("data:") || markerIndex < 0) {
    throw new Error("only embedded base64 glTF buffers are supported")
  }

  const encoded = uri.slice(markerIndex + marker.length)
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function decodeEmbeddedGltf(text: string): MeshGeometry {
  const gltf = JSON.parse(text) as GltfDocument
  if (gltf.asset?.version !== "2.0") {
    throw new Error("expected glTF 2.0")
  }

  const primitive = gltf.meshes?.[0]?.primitives?.[0]
  if (!primitive || primitive.mode !== 4 || primitive.attributes?.POSITION === undefined || primitive.indices === undefined) {
    throw new Error("expected one indexed triangle primitive")
  }

  const positionAccessor = gltf.accessors?.[primitive.attributes.POSITION]
  const indexAccessor = gltf.accessors?.[primitive.indices]
  const positionView = positionAccessor === undefined ? undefined : gltf.bufferViews?.[positionAccessor.bufferView]
  const indexView = indexAccessor === undefined ? undefined : gltf.bufferViews?.[indexAccessor.bufferView]
  if (!positionAccessor || !indexAccessor || !positionView || !indexView) {
    throw new Error("glTF primitive references missing accessors or buffer views")
  }
  if (positionAccessor.componentType !== 5126 || positionAccessor.type !== "VEC3") {
    throw new Error("positions must be float32 VEC3")
  }
  if (indexAccessor.type !== "SCALAR" || ![5123, 5125].includes(indexAccessor.componentType)) {
    throw new Error("indices must be unsigned integer scalars")
  }
  if (indexAccessor.count % 3 !== 0) {
    throw new Error("triangle index count must be divisible by three")
  }

  const positionBuffer = gltf.buffers?.[positionView.buffer]
  const indexBuffer = gltf.buffers?.[indexView.buffer]
  if (!positionBuffer?.uri || !indexBuffer?.uri || positionBuffer !== indexBuffer) {
    throw new Error("the lab asset must use one embedded buffer")
  }

  const bytes = decodeDataUri(positionBuffer.uri)
  if (bytes.byteLength !== positionBuffer.byteLength) {
    throw new Error("embedded glTF buffer length mismatch")
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const positionOffset = (positionView.byteOffset ?? 0) + (positionAccessor.byteOffset ?? 0)
  const positions: Array<[number, number, number]> = []
  for (let index = 0; index < positionAccessor.count; index += 1) {
    const offset = positionOffset + index * 12
    positions.push([
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ])
  }

  const indexOffset = (indexView.byteOffset ?? 0) + (indexAccessor.byteOffset ?? 0)
  const indexSize = indexAccessor.componentType === 5123 ? 2 : 4
  const indices: number[] = []
  for (let index = 0; index < indexAccessor.count; index += 1) {
    const offset = indexOffset + index * indexSize
    indices.push(indexAccessor.componentType === 5123 ? view.getUint16(offset, true) : view.getUint32(offset, true))
  }

  if (indices.some((index) => index >= positions.length)) {
    throw new Error("glTF index points outside the position accessor")
  }

  return {positions, indices}
}

export function inspectMeshGeometry(geometry: MeshGeometry) {
  return {
    vertices: geometry.positions.length,
    triangles: geometry.indices.length / 3,
  }
}
