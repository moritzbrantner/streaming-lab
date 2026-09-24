import type {MeshGeometry} from "./object-asset"

export type Vector3 = [number, number, number]

export type MeshRegionId = "right" | "left" | "top" | "bottom" | "front" | "back"

export type MeshRegion = {
  id: MeshRegionId
  firstTriangle: number
  center: Vector3
  normal: Vector3
  triangleCount: number
  vertexCount: number
  geometryBytes: number
  packageBytes: number
}

export type MeshRegionPartition = {
  regions: MeshRegion[]
  triangleCount: number
  vertexCount: number
  monolithicGeometryBytes: number
  regionGeometryBytes: number
  monolithicPackageBytes: number
  regionPackageBytes: number
}

export type MeshRegionStrategy = "source-order" | "view-priority"

export type MeshRegionStreamingInput = {
  partition: MeshRegionPartition
  cameraPosition: Vector3
  bandwidthMbps: number
  latencyMs: number
  budgetMs: number
  strategy: MeshRegionStrategy
}

export type MeshRegionDelivery = MeshRegion & {
  order: number
  viewFacing: boolean
  distance: number
  completedAtMs: number
}

export type MeshRegionStreamingResult = {
  deliveries: MeshRegionDelivery[]
  firstVisibleMs: number | null
  visibleTriangles: number
  visibleTrianglesWithinBudget: number
  completeMs: number
  payloadBytes: number
  duplicatedBytes: number
  packageOverheadBytes: number
}

export type MeshRegionPackage = {
  schemaVersion: 1
  region: MeshRegionId
  sourceGeometrySha256: string
  firstTriangle: number
  sourceTriangleIndexes: number[]
  sourceVertexIndexes: number[]
  positions: Vector3[]
  indices: number[]
}

export type MeshRegionManifestEntry = {
  id: MeshRegionId
  file: string
  byteLength: number
  sha256: string
  geometrySha256: string
  firstTriangle: number
  triangleCount: number
  vertexCount: number
  geometryBytes: number
  center: Vector3
  normal: Vector3
}

export type MeshRegionManifest = {
  schemaVersion: 1
  asset: string
  sourceCheckpoint: string
  sourceByteLength: number
  sourceSha256: string
  sourceGeometrySha256: string
  sourceVertices: number
  sourceTriangles: number
  sourceGeometryBytes: number
  regions: MeshRegionManifestEntry[]
}

type RegionAccumulator = {
  id: MeshRegionId
  firstTriangle: number
  centroidSum: Vector3
  normalSum: Vector3
  sourceTriangleIndexes: number[]
  vertexIndexes: Set<number>
}

const axisIds = [
  ["left", "right"],
  ["bottom", "top"],
  ["back", "front"],
] as const

const regionIds = new Set<MeshRegionId>(["right", "left", "top", "bottom", "front", "back"])
const sha256Pattern = /^[a-f0-9]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isVector3(value: unknown): value is Vector3 {
  return Array.isArray(value) && value.length === 3 && value.every(
    (component) => typeof component === "number" && Number.isFinite(component),
  )
}

function isRegionId(value: unknown): value is MeshRegionId {
  return typeof value === "string" && regionIds.has(value as MeshRegionId)
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function dot(left: Vector3, right: Vector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function magnitude(value: Vector3) {
  return Math.hypot(value[0], value[1], value[2])
}

function normalize(value: Vector3): Vector3 {
  const length = magnitude(value)
  if (length === 0) {
    throw new Error("mesh region direction must be non-zero")
  }
  return [value[0] / length, value[1] / length, value[2] / length]
}

function regionIdForNormal(normal: Vector3): MeshRegionId {
  let axis: 0 | 1 | 2 = 0
  if (Math.abs(normal[1]) > Math.abs(normal[0])) {
    axis = 1
  }
  const currentMagnitude = axis === 0 ? Math.abs(normal[0]) : Math.abs(normal[1])
  if (Math.abs(normal[2]) > currentMagnitude) {
    axis = 2
  }
  const direction = normal[axis] >= 0 ? 1 : 0
  return axisIds[axis][direction]
}

function triangleGeometryBytes(vertexCount: number, triangleCount: number) {
  return vertexCount * 12 + triangleCount * 3 * 2
}

function validatePosition(position: Vector3) {
  if (!position.every(Number.isFinite)) {
    throw new Error("mesh positions must contain finite coordinates")
  }
}

function classifyMeshRegions(geometry: MeshGeometry) {
  if (geometry.indices.length === 0 || geometry.indices.length % 3 !== 0) {
    throw new Error("mesh region partitioning requires indexed triangles")
  }

  const regions = new Map<MeshRegionId, RegionAccumulator>()

  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const triangle = offset / 3
    const aIndex = geometry.indices[offset]
    const bIndex = geometry.indices[offset + 1]
    const cIndex = geometry.indices[offset + 2]
    if (aIndex === undefined || bIndex === undefined || cIndex === undefined) {
      throw new Error("mesh region triangle is incomplete")
    }
    const a = geometry.positions[aIndex]
    const b = geometry.positions[bIndex]
    const c = geometry.positions[cIndex]
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error("mesh region triangle references a missing position")
    }
    validatePosition(a)
    validatePosition(b)
    validatePosition(c)

    const normal = normalize(cross(subtract(b, a), subtract(c, a)))
    const id = regionIdForNormal(normal)
    const centroid: Vector3 = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ]
    const current = regions.get(id) ?? {
      id,
      firstTriangle: triangle,
      centroidSum: [0, 0, 0],
      normalSum: [0, 0, 0],
      sourceTriangleIndexes: [],
      vertexIndexes: new Set<number>(),
    }
    current.firstTriangle = Math.min(current.firstTriangle, triangle)
    current.sourceTriangleIndexes.push(triangle)
    current.vertexIndexes.add(aIndex)
    current.vertexIndexes.add(bIndex)
    current.vertexIndexes.add(cIndex)
    current.centroidSum[0] += centroid[0]
    current.centroidSum[1] += centroid[1]
    current.centroidSum[2] += centroid[2]
    current.normalSum[0] += normal[0]
    current.normalSum[1] += normal[1]
    current.normalSum[2] += normal[2]
    regions.set(id, current)
  }

  return [...regions.values()].toSorted((left, right) => left.firstTriangle - right.firstTriangle)
}

function summaryFromAccumulator(region: RegionAccumulator): Omit<MeshRegion, "packageBytes"> {
  const triangleCount = region.sourceTriangleIndexes.length
  const vertexCount = region.vertexIndexes.size
  return {
    id: region.id,
    firstTriangle: region.firstTriangle,
    center: region.centroidSum.map((value) => value / triangleCount) as Vector3,
    normal: normalize(region.normalSum),
    triangleCount,
    vertexCount,
    geometryBytes: triangleGeometryBytes(vertexCount, triangleCount),
  }
}

export function partitionMeshRegions(geometry: MeshGeometry): MeshRegionPartition {
  const classified = classifyMeshRegions(geometry)
  const regions = classified.map((region): MeshRegion => {
    const summary = summaryFromAccumulator(region)
    return {...summary, packageBytes: summary.geometryBytes}
  })
  const triangleCount = geometry.indices.length / 3
  const regionTriangleCount = regions.reduce((total, region) => total + region.triangleCount, 0)
  if (regionTriangleCount !== triangleCount) {
    throw new Error("mesh region partitioning lost triangles")
  }

  const monolithicGeometryBytes = triangleGeometryBytes(geometry.positions.length, triangleCount)
  const regionGeometryBytes = regions.reduce((total, region) => total + region.geometryBytes, 0)

  return {
    regions,
    triangleCount,
    vertexCount: geometry.positions.length,
    monolithicGeometryBytes,
    regionGeometryBytes,
    monolithicPackageBytes: monolithicGeometryBytes,
    regionPackageBytes: regionGeometryBytes,
  }
}

export function materializeMeshRegionPackages(
  geometry: MeshGeometry,
  sourceGeometrySha256: string,
): MeshRegionPackage[] {
  if (!sha256Pattern.test(sourceGeometrySha256)) {
    throw new Error("invalid source geometry SHA-256")
  }

  return classifyMeshRegions(geometry).map((region) => {
    const sourceVertexIndexes = [...region.vertexIndexes].toSorted((left, right) => left - right)
    const localIndexBySource = new Map(sourceVertexIndexes.map((sourceIndex, localIndex) => [sourceIndex, localIndex]))
    const positions = sourceVertexIndexes.map((sourceIndex) => {
      const position = geometry.positions[sourceIndex]
      if (position === undefined) {
        throw new Error("mesh region source vertex is missing")
      }
      return [...position] as Vector3
    })
    const indices: number[] = []

    for (const sourceTriangleIndex of region.sourceTriangleIndexes) {
      const offset = sourceTriangleIndex * 3
      for (let corner = 0; corner < 3; corner += 1) {
        const sourceVertexIndex = geometry.indices[offset + corner]
        if (sourceVertexIndex === undefined) {
          throw new Error("mesh region source triangle is incomplete")
        }
        const localIndex = localIndexBySource.get(sourceVertexIndex)
        if (localIndex === undefined) {
          throw new Error("mesh region local vertex mapping is incomplete")
        }
        indices.push(localIndex)
      }
    }

    return {
      schemaVersion: 1,
      region: region.id,
      sourceGeometrySha256,
      firstTriangle: region.firstTriangle,
      sourceTriangleIndexes: [...region.sourceTriangleIndexes],
      sourceVertexIndexes,
      positions,
      indices,
    }
  })
}

export function serializeMeshRegionPackage(regionPackage: MeshRegionPackage) {
  return `${JSON.stringify(regionPackage)}\n`
}

export function parseMeshRegionPackage(text: string): MeshRegionPackage {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRegionId(value.region) ||
    typeof value.sourceGeometrySha256 !== "string" ||
    !sha256Pattern.test(value.sourceGeometrySha256) ||
    !isNonNegativeInteger(value.firstTriangle) ||
    !Array.isArray(value.sourceTriangleIndexes) ||
    !Array.isArray(value.sourceVertexIndexes) ||
    !Array.isArray(value.positions) ||
    !Array.isArray(value.indices)
  ) {
    throw new Error("invalid mesh region package")
  }

  const sourceTriangleIndexes = value.sourceTriangleIndexes
  if (
    sourceTriangleIndexes.length === 0 ||
    !sourceTriangleIndexes.every(isNonNegativeInteger) ||
    sourceTriangleIndexes.some((triangle, index) => index > 0 && triangle <= sourceTriangleIndexes[index - 1])
  ) {
    throw new Error("mesh region source triangle indexes must be strictly increasing")
  }
  if (sourceTriangleIndexes[0] !== value.firstTriangle) {
    throw new Error("mesh region first triangle does not match its source triangle indexes")
  }

  const sourceVertexIndexes = value.sourceVertexIndexes
  if (
    sourceVertexIndexes.length === 0 ||
    !sourceVertexIndexes.every(isNonNegativeInteger) ||
    sourceVertexIndexes.some((vertex, index) => index > 0 && vertex <= sourceVertexIndexes[index - 1])
  ) {
    throw new Error("mesh region source vertex indexes must be strictly increasing")
  }

  if (value.positions.length !== sourceVertexIndexes.length || !value.positions.every(isVector3)) {
    throw new Error("mesh region positions do not match source vertex provenance")
  }
  if (
    value.indices.length !== sourceTriangleIndexes.length * 3 ||
    !value.indices.every((index) => isNonNegativeInteger(index) && index < value.positions.length)
  ) {
    throw new Error("mesh region indices do not match its source triangle provenance")
  }

  return {
    schemaVersion: 1,
    region: value.region,
    sourceGeometrySha256: value.sourceGeometrySha256,
    firstTriangle: value.firstTriangle,
    sourceTriangleIndexes: [...sourceTriangleIndexes],
    sourceVertexIndexes: [...sourceVertexIndexes],
    positions: value.positions.map((position) => [...position] as Vector3),
    indices: [...value.indices],
  }
}

export function decodeMeshRegionPackage(regionPackage: MeshRegionPackage): MeshGeometry {
  return {
    positions: regionPackage.positions.map((position) => [...position] as Vector3),
    indices: [...regionPackage.indices],
  }
}

export function serializeMeshRegionManifest(manifest: MeshRegionManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function parseMeshRegionManifest(text: string): MeshRegionManifest {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.asset !== "string" ||
    value.asset.length === 0 ||
    typeof value.sourceCheckpoint !== "string" ||
    !/^[a-z0-9-]+\.gltf$/.test(value.sourceCheckpoint) ||
    !isPositiveInteger(value.sourceByteLength) ||
    typeof value.sourceSha256 !== "string" ||
    !sha256Pattern.test(value.sourceSha256) ||
    typeof value.sourceGeometrySha256 !== "string" ||
    !sha256Pattern.test(value.sourceGeometrySha256) ||
    !isPositiveInteger(value.sourceVertices) ||
    !isPositiveInteger(value.sourceTriangles) ||
    !isPositiveInteger(value.sourceGeometryBytes) ||
    !Array.isArray(value.regions) ||
    value.regions.length === 0
  ) {
    throw new Error("invalid mesh region manifest")
  }

  const seenIds = new Set<MeshRegionId>()
  const seenFiles = new Set<string>()
  const regions = value.regions.map((entry, index): MeshRegionManifestEntry => {
    if (
      !isRecord(entry) ||
      !isRegionId(entry.id) ||
      typeof entry.file !== "string" ||
      entry.file !== `region-${entry.id}.json` ||
      !isPositiveInteger(entry.byteLength) ||
      typeof entry.sha256 !== "string" ||
      !sha256Pattern.test(entry.sha256) ||
      typeof entry.geometrySha256 !== "string" ||
      !sha256Pattern.test(entry.geometrySha256) ||
      !isNonNegativeInteger(entry.firstTriangle) ||
      !isPositiveInteger(entry.triangleCount) ||
      !isPositiveInteger(entry.vertexCount) ||
      !isPositiveInteger(entry.geometryBytes) ||
      !isVector3(entry.center) ||
      !isVector3(entry.normal)
    ) {
      throw new Error(`invalid mesh region manifest entry ${index}`)
    }
    if (seenIds.has(entry.id) || seenFiles.has(entry.file)) {
      throw new Error("mesh region manifest entries must be unique")
    }
    if (entry.geometryBytes !== triangleGeometryBytes(entry.vertexCount, entry.triangleCount)) {
      throw new Error(`${entry.file}: geometry byte count does not match its mesh shape`)
    }
    seenIds.add(entry.id)
    seenFiles.add(entry.file)

    return {
      id: entry.id,
      file: entry.file,
      byteLength: entry.byteLength,
      sha256: entry.sha256,
      geometrySha256: entry.geometrySha256,
      firstTriangle: entry.firstTriangle,
      triangleCount: entry.triangleCount,
      vertexCount: entry.vertexCount,
      geometryBytes: entry.geometryBytes,
      center: [...entry.center] as Vector3,
      normal: [...entry.normal] as Vector3,
    }
  })

  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index].firstTriangle <= regions[index - 1].firstTriangle) {
      throw new Error("mesh region manifest entries must follow source triangle order")
    }
  }
  if (regions.reduce((total, region) => total + region.triangleCount, 0) !== value.sourceTriangles) {
    throw new Error("mesh region manifest does not cover every source triangle exactly once")
  }

  return {
    schemaVersion: 1,
    asset: value.asset,
    sourceCheckpoint: value.sourceCheckpoint,
    sourceByteLength: value.sourceByteLength,
    sourceSha256: value.sourceSha256,
    sourceGeometrySha256: value.sourceGeometrySha256,
    sourceVertices: value.sourceVertices,
    sourceTriangles: value.sourceTriangles,
    sourceGeometryBytes: value.sourceGeometryBytes,
    regions,
  }
}

export function partitionMeshRegionManifest(manifest: MeshRegionManifest): MeshRegionPartition {
  const regions = manifest.regions.map((entry): MeshRegion => ({
    id: entry.id,
    firstTriangle: entry.firstTriangle,
    center: [...entry.center] as Vector3,
    normal: [...entry.normal] as Vector3,
    triangleCount: entry.triangleCount,
    vertexCount: entry.vertexCount,
    geometryBytes: entry.geometryBytes,
    packageBytes: entry.byteLength,
  }))
  return {
    regions,
    triangleCount: manifest.sourceTriangles,
    vertexCount: manifest.sourceVertices,
    monolithicGeometryBytes: manifest.sourceGeometryBytes,
    regionGeometryBytes: regions.reduce((total, region) => total + region.geometryBytes, 0),
    monolithicPackageBytes: manifest.sourceByteLength,
    regionPackageBytes: regions.reduce((total, region) => total + region.packageBytes, 0),
  }
}

function serializationMs(bytes: number, bandwidthMbps: number) {
  return (bytes * 8 * 1000) / (bandwidthMbps * 1_000_000)
}

function validateStreamingInput(input: MeshRegionStreamingInput) {
  if (
    !Number.isFinite(input.bandwidthMbps) ||
    input.bandwidthMbps <= 0 ||
    !Number.isFinite(input.latencyMs) ||
    input.latencyMs < 0 ||
    !Number.isFinite(input.budgetMs) ||
    input.budgetMs < 0 ||
    !input.cameraPosition.every(Number.isFinite)
  ) {
    throw new Error("invalid mesh region streaming input")
  }
}

export function simulateMeshRegionStreaming(input: MeshRegionStreamingInput): MeshRegionStreamingResult {
  validateStreamingInput(input)

  const candidates = input.partition.regions.map((region) => {
    const toCamera = subtract(input.cameraPosition, region.center)
    return {
      ...region,
      viewFacing: dot(region.normal, toCamera) > 0,
      distance: magnitude(toCamera),
    }
  })
  const ordered = candidates.toSorted((left, right) => {
    if (input.strategy === "source-order") {
      return left.firstTriangle - right.firstTriangle
    }
    if (left.viewFacing !== right.viewFacing) {
      return left.viewFacing ? -1 : 1
    }
    const distanceDifference = left.distance - right.distance
    if (Math.abs(distanceDifference) > 1e-9) {
      return distanceDifference
    }
    return left.firstTriangle - right.firstTriangle
  })

  let elapsedMs = 0
  const deliveries: MeshRegionDelivery[] = ordered.map((region, index) => {
    elapsedMs += input.latencyMs + serializationMs(region.packageBytes, input.bandwidthMbps)
    return {...region, order: index + 1, completedAtMs: elapsedMs}
  })
  const visible = deliveries.filter((delivery) => delivery.viewFacing)
  const payloadBytes = input.partition.regionPackageBytes

  return {
    deliveries,
    firstVisibleMs: visible[0]?.completedAtMs ?? null,
    visibleTriangles: visible.reduce((total, delivery) => total + delivery.triangleCount, 0),
    visibleTrianglesWithinBudget: visible
      .filter((delivery) => delivery.completedAtMs <= input.budgetMs)
      .reduce((total, delivery) => total + delivery.triangleCount, 0),
    completeMs: input.partition.regions.length * input.latencyMs + serializationMs(payloadBytes, input.bandwidthMbps),
    payloadBytes,
    duplicatedBytes: input.partition.regionGeometryBytes - input.partition.monolithicGeometryBytes,
    packageOverheadBytes: input.partition.regionPackageBytes - input.partition.monolithicPackageBytes,
  }
}
