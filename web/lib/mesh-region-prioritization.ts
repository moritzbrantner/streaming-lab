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
  payloadBytes: number
}

export type MeshRegionPartition = {
  regions: MeshRegion[]
  triangleCount: number
  vertexCount: number
  monolithicPayloadBytes: number
  regionPayloadBytes: number
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
}

type RegionAccumulator = {
  id: MeshRegionId
  firstTriangle: number
  centroidSum: Vector3
  normalSum: Vector3
  triangleCount: number
  vertexIndexes: Set<number>
}

const axisIds = [
  ["left", "right"],
  ["bottom", "top"],
  ["back", "front"],
] as const

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
  if (length === 0) {\n    throw new Error("mesh region direction must be non-zero")\n  }
  return [value[0] / length, value[1] / length, value[2] / length]
}

function regionIdForNormal(normal: Vector3): MeshRegionId {
  let axis: 0 | 1 | 2 = 0
  if (Math.abs(normal[1]) > Math.abs(normal[0])) {\n    axis = 1\n  }
  const currentMagnitude = axis === 0 ? Math.abs(normal[0]) : Math.abs(normal[1])
  if (Math.abs(normal[2]) > currentMagnitude) {\n    axis = 2\n  }
  const direction = normal[axis] >= 0 ? 1 : 0
  return axisIds[axis][direction]
}

function trianglePayloadBytes(vertexCount: number, triangleCount: number) {
  return vertexCount * 12 + triangleCount * 3 * 2
}

function validatePosition(position: Vector3) {
  if (!position.every(Number.isFinite)) {\n    throw new Error("mesh positions must contain finite coordinates")\n  }
}

export function partitionMeshRegions(geometry: MeshGeometry): MeshRegionPartition {
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
      triangleCount: 0,
      vertexIndexes: new Set<number>(),
    }
    current.firstTriangle = Math.min(current.firstTriangle, triangle)
    current.triangleCount += 1
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

  const partitioned = [...regions.values()]
    .toSorted((left, right) => left.firstTriangle - right.firstTriangle)
    .map((region): MeshRegion => ({
      id: region.id,
      firstTriangle: region.firstTriangle,
      center: region.centroidSum.map((value) => value / region.triangleCount) as Vector3,
      normal: normalize(region.normalSum),
      triangleCount: region.triangleCount,
      vertexCount: region.vertexIndexes.size,
      payloadBytes: trianglePayloadBytes(region.vertexIndexes.size, region.triangleCount),
    }))

  const triangleCount = geometry.indices.length / 3
  const regionTriangleCount = partitioned.reduce((total, region) => total + region.triangleCount, 0)
  if (regionTriangleCount !== triangleCount) {\n    throw new Error("mesh region partitioning lost triangles")\n  }

  return {
    regions: partitioned,
    triangleCount,
    vertexCount: geometry.positions.length,
    monolithicPayloadBytes: trianglePayloadBytes(geometry.positions.length, triangleCount),
    regionPayloadBytes: partitioned.reduce((total, region) => total + region.payloadBytes, 0),
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
    if (input.strategy === "source-order") {\n      return left.firstTriangle - right.firstTriangle\n    }
    if (left.viewFacing !== right.viewFacing) {\n      return left.viewFacing ? -1 : 1\n    }
    const distanceDifference = left.distance - right.distance
    if (Math.abs(distanceDifference) > 1e-9) {\n      return distanceDifference\n    }
    return left.firstTriangle - right.firstTriangle
  })

  let elapsedMs = 0
  const deliveries: MeshRegionDelivery[] = ordered.map((region, index) => {
    elapsedMs += input.latencyMs + serializationMs(region.payloadBytes, input.bandwidthMbps)
    return {...region, order: index + 1, completedAtMs: elapsedMs}
  })
  const visible = deliveries.filter((delivery) => delivery.viewFacing)
  const payloadBytes = input.partition.regionPayloadBytes

  return {
    deliveries,
    firstVisibleMs: visible[0]?.completedAtMs ?? null,
    visibleTriangles: visible.reduce((total, delivery) => total + delivery.triangleCount, 0),
    visibleTrianglesWithinBudget: visible
      .filter((delivery) => delivery.completedAtMs <= input.budgetMs)
      .reduce((total, delivery) => total + delivery.triangleCount, 0),
    completeMs: input.partition.regions.length * input.latencyMs + serializationMs(payloadBytes, input.bandwidthMbps),
    payloadBytes,
    duplicatedBytes: payloadBytes - input.partition.monolithicPayloadBytes,
  }
}
