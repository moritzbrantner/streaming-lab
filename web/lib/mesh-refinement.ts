import type {MeshGeometry} from "./object-asset"

export type RefinementCheckpointEntry = {
  level: number
  label: string
  file: string
  byteLength: number
  vertices: number
  triangles: number
  sha256: string
  geometrySha256: string
}

export type RefinementDeltaEntry = {
  fromLevel: number
  toLevel: number
  file: string
  byteLength: number
  appendedVertices: number
  triangles: number
  sha256: string
  baseGeometrySha256: string
  resultGeometrySha256: string
}

export type RefinementManifest = {
  schemaVersion: 2
  asset: string
  sourceCheckpoint: string
  sourceGeometrySha256: string
  checkpoints: RefinementCheckpointEntry[]
  refinements: RefinementDeltaEntry[]
  compressedRefinements: RefinementDeltaEntry[]
}

type MeshRefinementPackageBase = {
  fromLevel: number
  toLevel: number
  baseGeometrySha256: string
  resultGeometrySha256: string
  appendedVertices: number
  resultVertices: number
  triangles: number
  positions: string
  indices: string
}

export type PlainMeshRefinementPackage = MeshRefinementPackageBase & {
  schemaVersion: 1
  positionEncoding: "float32-le-base64"
  indexEncoding: "uint16-le-base64"
}

export type CompressedMeshRefinementPackage = MeshRefinementPackageBase & {
  schemaVersion: 2
  positionEncoding: "float32-xor-varint-base64"
  indexEncoding: "delta-zigzag-varint-base64"
}

export type MeshRefinementPackage = PlainMeshRefinementPackage | CompressedMeshRefinementPackage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function isAssetFile(value: unknown, suffix: "gltf" | "json"): value is string {
  return typeof value === "string" && new RegExp(`^[a-z0-9-]+\\.${suffix}$`).test(value)
}

function parseRefinementEntries(
  value: unknown,
  checkpoints: RefinementCheckpointEntry[],
  label: string,
): RefinementDeltaEntry[] {
  if (!Array.isArray(value)) throw new Error(`invalid ${label}`)

  const refinements = value.map((entry, index): RefinementDeltaEntry => {
    if (
      !isRecord(entry) ||
      entry.fromLevel !== index ||
      entry.toLevel !== index + 1 ||
      !isAssetFile(entry.file, "json") ||
      !isPositiveInteger(entry.byteLength) ||
      !isPositiveInteger(entry.appendedVertices) ||
      !isPositiveInteger(entry.triangles) ||
      !isSha256(entry.sha256) ||
      !isSha256(entry.baseGeometrySha256) ||
      !isSha256(entry.resultGeometrySha256)
    ) {
      throw new Error(`invalid ${label} entry ${index}`)
    }
    if (
      entry.baseGeometrySha256 !== checkpoints[index]?.geometrySha256 ||
      entry.resultGeometrySha256 !== checkpoints[index + 1]?.geometrySha256 ||
      entry.appendedVertices !== checkpoints[index + 1]?.vertices - checkpoints[index]?.vertices ||
      entry.triangles !== checkpoints[index + 1]?.triangles
    ) {
      throw new Error(`${label} entry ${index} does not bind adjacent checkpoints`)
    }
    return {
      fromLevel: index,
      toLevel: index + 1,
      file: entry.file,
      byteLength: entry.byteLength,
      appendedVertices: entry.appendedVertices,
      triangles: entry.triangles,
      sha256: entry.sha256,
      baseGeometrySha256: entry.baseGeometrySha256,
      resultGeometrySha256: entry.resultGeometrySha256,
    }
  })

  if (refinements.length !== checkpoints.length - 1) {
    throw new Error(`${label} must provide one delta between every checkpoint`)
  }
  return refinements
}

export function parseRefinementManifest(text: string): RefinementManifest {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    typeof value.asset !== "string" ||
    !isAssetFile(value.sourceCheckpoint, "gltf") ||
    !isSha256(value.sourceGeometrySha256) ||
    !Array.isArray(value.checkpoints)
  ) {
    throw new Error("invalid refinement manifest")
  }

  const checkpoints = value.checkpoints.map((entry, level): RefinementCheckpointEntry => {
    if (
      !isRecord(entry) ||
      entry.level !== level ||
      typeof entry.label !== "string" ||
      !isAssetFile(entry.file, "gltf") ||
      !isPositiveInteger(entry.byteLength) ||
      !isPositiveInteger(entry.vertices) ||
      !isPositiveInteger(entry.triangles) ||
      !isSha256(entry.sha256) ||
      !isSha256(entry.geometrySha256)
    ) {
      throw new Error(`invalid refinement checkpoint ${level}`)
    }
    return {
      level,
      label: entry.label,
      file: entry.file,
      byteLength: entry.byteLength,
      vertices: entry.vertices,
      triangles: entry.triangles,
      sha256: entry.sha256,
      geometrySha256: entry.geometrySha256,
    }
  })

  if (checkpoints.length < 2) {
    throw new Error("refinement manifest requires at least two checkpoints")
  }
  for (let level = 1; level < checkpoints.length; level += 1) {
    if (
      checkpoints[level].vertices <= checkpoints[level - 1].vertices ||
      checkpoints[level].triangles <= checkpoints[level - 1].triangles
    ) {
      throw new Error("refinement checkpoint detail must strictly increase")
    }
  }

  const refinements = parseRefinementEntries(value.refinements, checkpoints, "refinement packages")
  const compressedRefinements = parseRefinementEntries(
    value.compressedRefinements,
    checkpoints,
    "compressed refinement packages",
  )

  const source = checkpoints.at(-1)
  if (
    source === undefined ||
    value.sourceCheckpoint !== source.file ||
    value.sourceGeometrySha256 !== source.geometrySha256
  ) {
    throw new Error("refinement source must be the highest-detail checkpoint")
  }

  return {
    schemaVersion: 2,
    asset: value.asset,
    sourceCheckpoint: value.sourceCheckpoint,
    sourceGeometrySha256: value.sourceGeometrySha256,
    checkpoints,
    refinements,
    compressedRefinements,
  }
}

export function parseMeshRefinementPackage(text: string): MeshRefinementPackage {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    ![1, 2].includes(value.schemaVersion as number) ||
    !isNonNegativeInteger(value.fromLevel) ||
    value.toLevel !== value.fromLevel + 1 ||
    !isSha256(value.baseGeometrySha256) ||
    !isSha256(value.resultGeometrySha256) ||
    !isPositiveInteger(value.appendedVertices) ||
    !isPositiveInteger(value.resultVertices) ||
    !isPositiveInteger(value.triangles) ||
    typeof value.positions !== "string" ||
    typeof value.indices !== "string"
  ) {
    throw new Error("invalid mesh refinement package")
  }

  const common = {
    fromLevel: value.fromLevel,
    toLevel: value.toLevel,
    baseGeometrySha256: value.baseGeometrySha256,
    resultGeometrySha256: value.resultGeometrySha256,
    appendedVertices: value.appendedVertices,
    resultVertices: value.resultVertices,
    triangles: value.triangles,
    positions: value.positions,
    indices: value.indices,
  }

  if (
    value.schemaVersion === 1 &&
    value.positionEncoding === "float32-le-base64" &&
    value.indexEncoding === "uint16-le-base64"
  ) {
    return {
      schemaVersion: 1,
      ...common,
      positionEncoding: "float32-le-base64",
      indexEncoding: "uint16-le-base64",
    }
  }
  if (
    value.schemaVersion === 2 &&
    value.positionEncoding === "float32-xor-varint-base64" &&
    value.indexEncoding === "delta-zigzag-varint-base64"
  ) {
    return {
      schemaVersion: 2,
      ...common,
      positionEncoding: "float32-xor-varint-base64",
      indexEncoding: "delta-zigzag-varint-base64",
    }
  }
  throw new Error("unsupported mesh refinement encoding")
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function encodeUnsignedVarints(values: number[]) {
  const bytes: number[] = []
  for (const originalValue of values) {
    if (!Number.isInteger(originalValue) || originalValue < 0 || originalValue > 0xffffffff) {
      throw new Error("varint values must be uint32")
    }
    let value = originalValue
    while (value >= 0x80) {
      bytes.push((value % 0x80) | 0x80)
      value = Math.floor(value / 0x80)
    }
    bytes.push(value)
  }
  return Uint8Array.from(bytes)
}

function decodeUnsignedVarints(encoded: string, expectedCount: number, label: string) {
  const bytes = decodeBase64(encoded)
  const values: number[] = []
  let offset = 0

  while (values.length < expectedCount) {
    let value = 0
    let shift = 0
    while (true) {
      if (offset >= bytes.length) throw new Error(`${label} varint payload ended early`)
      const byte = bytes[offset]
      offset += 1
      const payload = byte & 0x7f
      if (shift === 28 && payload > 0x0f) throw new Error(`${label} varint exceeds uint32`)
      value += payload * 2 ** shift
      if ((byte & 0x80) === 0) {
        if (shift > 0 && payload === 0) throw new Error(`${label} varint is not canonical`)
        values.push(value)
        break
      }
      if (shift === 28) throw new Error(`${label} varint exceeds uint32`)
      shift += 7
    }
  }

  if (offset !== bytes.length) throw new Error(`${label} varint payload has trailing bytes`)
  return values
}

function decodePlainPositions(value: string, count: number): Array<[number, number, number]> {
  const bytes = decodeBase64(value)
  if (bytes.byteLength !== count * 12) throw new Error("refinement position payload length mismatch")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({length: count}, (_, index) => {
    const offset = index * 12
    return [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)]
  })
}

function decodeCompressedPositions(value: string, count: number): Array<[number, number, number]> {
  const deltas = decodeUnsignedVarints(value, count * 3, "refinement position")
  const previous = [0, 0, 0]
  const scratch = new DataView(new ArrayBuffer(4))
  let offset = 0
  return Array.from({length: count}, () => {
    const position: [number, number, number] = [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      const bits = (previous[axis] ^ deltas[offset]) >>> 0
      offset += 1
      previous[axis] = bits
      scratch.setUint32(0, bits, true)
      position[axis] = scratch.getFloat32(0, true)
    }
    return position
  })
}

function decodePlainIndices(value: string, triangles: number) {
  const count = triangles * 3
  const bytes = decodeBase64(value)
  if (bytes.byteLength !== count * 2) throw new Error("refinement index payload length mismatch")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({length: count}, (_, index) => view.getUint16(index * 2, true))
}

function decodeCompressedIndices(value: string, triangles: number) {
  const encoded = decodeUnsignedVarints(value, triangles * 3, "refinement index")
  let previous = 0
  return encoded.map((zigzag) => {
    const delta = zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2
    const index = previous + delta
    if (!Number.isInteger(index) || index < 0 || index > 0xffff) {
      throw new Error("compressed refinement index is outside uint16 range")
    }
    previous = index
    return index
  })
}

export function compressMeshRefinementPackage(refinement: PlainMeshRefinementPackage): CompressedMeshRefinementPackage {
  const positionBytes = decodeBase64(refinement.positions)
  if (positionBytes.byteLength !== refinement.appendedVertices * 12) {
    throw new Error("refinement position payload length mismatch")
  }
  const positionView = new DataView(positionBytes.buffer, positionBytes.byteOffset, positionBytes.byteLength)
  const previousBits = [0, 0, 0]
  const positionDeltas: number[] = []
  for (let index = 0; index < refinement.appendedVertices * 3; index += 1) {
    const axis = index % 3
    const bits = positionView.getUint32(index * 4, true)
    positionDeltas.push((bits ^ previousBits[axis]) >>> 0)
    previousBits[axis] = bits
  }

  const indices = decodePlainIndices(refinement.indices, refinement.triangles)
  let previousIndex = 0
  const indexDeltas = indices.map((index) => {
    const delta = index - previousIndex
    previousIndex = index
    return delta >= 0 ? delta * 2 : -delta * 2 - 1
  })

  return {
    schemaVersion: 2,
    fromLevel: refinement.fromLevel,
    toLevel: refinement.toLevel,
    baseGeometrySha256: refinement.baseGeometrySha256,
    resultGeometrySha256: refinement.resultGeometrySha256,
    appendedVertices: refinement.appendedVertices,
    resultVertices: refinement.resultVertices,
    triangles: refinement.triangles,
    positionEncoding: "float32-xor-varint-base64",
    indexEncoding: "delta-zigzag-varint-base64",
    positions: encodeBase64(encodeUnsignedVarints(positionDeltas)),
    indices: encodeBase64(encodeUnsignedVarints(indexDeltas)),
  }
}

export function serializeMeshRefinementPackage(refinement: MeshRefinementPackage) {
  return `${JSON.stringify(refinement)}\n`
}

export function canonicalMeshBytes(geometry: MeshGeometry) {
  const bytes = new Uint8Array(8 + geometry.positions.length * 12 + geometry.indices.length * 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, geometry.positions.length, true)
  view.setUint32(4, geometry.indices.length, true)
  let offset = 8
  for (const position of geometry.positions) {
    for (const component of position) {
      view.setFloat32(offset, Math.fround(component), true)
      offset += 4
    }
  }
  for (const index of geometry.indices) {
    if (!Number.isInteger(index) || index < 0) throw new Error("mesh indices must be non-negative integers")
    view.setUint32(offset, index, true)
    offset += 4
  }
  return bytes
}

export function applyMeshRefinement(
  base: MeshGeometry,
  refinement: MeshRefinementPackage,
  baseGeometrySha256: string,
): MeshGeometry {
  if (baseGeometrySha256 !== refinement.baseGeometrySha256) {
    throw new Error("refinement base geometry fingerprint mismatch")
  }

  const appended = refinement.schemaVersion === 1
    ? decodePlainPositions(refinement.positions, refinement.appendedVertices)
    : decodeCompressedPositions(refinement.positions, refinement.appendedVertices)
  const positions = [...base.positions, ...appended]
  if (positions.length !== refinement.resultVertices) {
    throw new Error("refinement result vertex count mismatch")
  }

  const indices = refinement.schemaVersion === 1
    ? decodePlainIndices(refinement.indices, refinement.triangles)
    : decodeCompressedIndices(refinement.indices, refinement.triangles)
  if (indices.some((index) => index >= positions.length)) {
    throw new Error("refinement index points outside the resulting vertex set")
  }

  return {positions, indices}
}
