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
  schemaVersion: 1
  asset: string
  sourceCheckpoint: string
  sourceGeometrySha256: string
  checkpoints: RefinementCheckpointEntry[]
  refinements: RefinementDeltaEntry[]
}

export type MeshRefinementPackage = {
  schemaVersion: 1
  fromLevel: number
  toLevel: number
  baseGeometrySha256: string
  resultGeometrySha256: string
  appendedVertices: number
  resultVertices: number
  triangles: number
  positionEncoding: "float32-le-base64"
  indexEncoding: "uint16-le-base64"
  positions: string
  indices: string
}

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

export function parseRefinementManifest(text: string): RefinementManifest {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.asset !== "string" ||
    !isAssetFile(value.sourceCheckpoint, "gltf") ||
    !isSha256(value.sourceGeometrySha256) ||
    !Array.isArray(value.checkpoints) ||
    !Array.isArray(value.refinements)
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

  const refinements = value.refinements.map((entry, index): RefinementDeltaEntry => {
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
      throw new Error(`invalid refinement package entry ${index}`)
    }
    if (
      entry.baseGeometrySha256 !== checkpoints[index]?.geometrySha256 ||
      entry.resultGeometrySha256 !== checkpoints[index + 1]?.geometrySha256 ||
      entry.triangles !== checkpoints[index + 1]?.triangles
    ) {
      throw new Error(`refinement package ${index} does not bind adjacent checkpoints`)
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
    throw new Error("refinement manifest must provide one delta between every checkpoint")
  }

  const source = checkpoints.at(-1)
  if (
    source === undefined ||
    value.sourceCheckpoint !== source.file ||
    value.sourceGeometrySha256 !== source.geometrySha256
  ) {
    throw new Error("refinement source must be the highest-detail checkpoint")
  }

  return {
    schemaVersion: 1,
    asset: value.asset,
    sourceCheckpoint: value.sourceCheckpoint,
    sourceGeometrySha256: value.sourceGeometrySha256,
    checkpoints,
    refinements,
  }
}

export function parseMeshRefinementPackage(text: string): MeshRefinementPackage {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isNonNegativeInteger(value.fromLevel) ||
    value.toLevel !== value.fromLevel + 1 ||
    !isSha256(value.baseGeometrySha256) ||
    !isSha256(value.resultGeometrySha256) ||
    !isPositiveInteger(value.appendedVertices) ||
    !isPositiveInteger(value.resultVertices) ||
    !isPositiveInteger(value.triangles) ||
    value.positionEncoding !== "float32-le-base64" ||
    value.indexEncoding !== "uint16-le-base64" ||
    typeof value.positions !== "string" ||
    typeof value.indices !== "string"
  ) {
    throw new Error("invalid mesh refinement package")
  }

  return {
    schemaVersion: 1,
    fromLevel: value.fromLevel,
    toLevel: value.toLevel,
    baseGeometrySha256: value.baseGeometrySha256,
    resultGeometrySha256: value.resultGeometrySha256,
    appendedVertices: value.appendedVertices,
    resultVertices: value.resultVertices,
    triangles: value.triangles,
    positionEncoding: value.positionEncoding,
    indexEncoding: value.indexEncoding,
    positions: value.positions,
    indices: value.indices,
  }
}

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function decodePositions(value: string, count: number): Array<[number, number, number]> {
  const bytes = decodeBase64(value)
  if (bytes.byteLength !== count * 12) throw new Error("refinement position payload length mismatch")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({length: count}, (_, index) => {
    const offset = index * 12
    return [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)]
  })
}

function decodeIndices(value: string, triangles: number) {
  const count = triangles * 3
  const bytes = decodeBase64(value)
  if (bytes.byteLength !== count * 2) throw new Error("refinement index payload length mismatch")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({length: count}, (_, index) => view.getUint16(index * 2, true))
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

  const appended = decodePositions(refinement.positions, refinement.appendedVertices)
  const positions = [...base.positions, ...appended]
  if (positions.length !== refinement.resultVertices) {
    throw new Error("refinement result vertex count mismatch")
  }

  const indices = decodeIndices(refinement.indices, refinement.triangles)
  if (indices.some((index) => index >= positions.length)) {
    throw new Error("refinement index points outside the resulting vertex set")
  }

  return {positions, indices}
}
