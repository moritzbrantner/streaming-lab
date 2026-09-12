export type ObjectStreamingStrategy = "dependent-refinements" | "independent-lods"

export const objectLods = [
  {level: 0, label: "Proxy", triangles: 600, totalBytes: 70_000},
  {level: 1, label: "Shape", triangles: 2_400, totalBytes: 240_000},
  {level: 2, label: "Detail", triangles: 9_600, totalBytes: 760_000},
  {level: 3, label: "Full", triangles: 38_400, totalBytes: 2_200_000},
] as const

export type ObjectLodDelivery = {
  level: number
  label: string
  triangles: number
  payloadBytes: number
  packetCount: number
  firstAttemptLostPackets: number
  remainingLostPackets: number
  transmittedBytes: number
  completedAtMs: number
  availableAtMs: number | null
  status: "available" | "lost" | "blocked"
}

export type ObjectStreamingResult = {
  lods: ObjectLodDelivery[]
  firstRenderableMs: number | null
  fullDetailMs: number | null
  bestAvailableLevel: number | null
  bestTriangles: number
  payloadBytes: number
  wireBytes: number
}

export type ObjectStreamingInput = {
  bandwidthMbps: number
  latencyMs: number
  lossPercent: number
  retry: boolean
  strategy: ObjectStreamingStrategy
  packetBytes?: number
  seed?: number
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

function serializationMs(bytes: number, bandwidthMbps: number) {
  return (bytes * 8 * 1000) / (bandwidthMbps * 1_000_000)
}

function packetSizes(payloadBytes: number, packetBytes: number) {
  const count = Math.ceil(payloadBytes / packetBytes)
  return Array.from({length: count}, (_, index) => Math.min(packetBytes, payloadBytes - index * packetBytes))
}

export function simulateObjectStreaming({
  bandwidthMbps,
  latencyMs,
  lossPercent,
  retry,
  strategy,
  packetBytes = 32_000,
  seed = 30,
}: ObjectStreamingInput): ObjectStreamingResult {
  if (bandwidthMbps <= 0 || latencyMs < 0 || lossPercent < 0 || lossPercent > 100 || packetBytes <= 0) {
    throw new Error("invalid object streaming input")
  }

  const random = seededRandom(seed)
  const lossProbability = lossPercent / 100
  const lods: ObjectLodDelivery[] = []
  let elapsedMs = 0
  let wireBytes = 0
  let payloadBytes = 0
  let previousLevelAvailable = true

  for (const lod of objectLods) {
    const previousTotalBytes = lod.level === 0 ? 0 : objectLods[lod.level - 1].totalBytes
    const stagePayloadBytes =
      strategy === "dependent-refinements" ? lod.totalBytes - previousTotalBytes : lod.totalBytes
    const sizes = packetSizes(stagePayloadBytes, packetBytes)
    const firstAttemptLostIndexes = sizes.flatMap((_, index) => (random() < lossProbability ? [index] : []))
    const retryBytes = retry
      ? firstAttemptLostIndexes.reduce((total, index) => total + sizes[index], 0)
      : 0
    const remainingLostIndexes = retry
      ? firstAttemptLostIndexes.filter(() => random() < lossProbability)
      : firstAttemptLostIndexes

    elapsedMs += latencyMs + serializationMs(stagePayloadBytes, bandwidthMbps)
    if (retry && firstAttemptLostIndexes.length > 0) {
      elapsedMs += latencyMs + serializationMs(retryBytes, bandwidthMbps)
    }

    payloadBytes += stagePayloadBytes
    wireBytes += stagePayloadBytes + retryBytes

    const transportComplete = remainingLostIndexes.length === 0
    const canApply = strategy === "independent-lods" || previousLevelAvailable
    const status: ObjectLodDelivery["status"] = !transportComplete
      ? "lost"
      : canApply
        ? "available"
        : "blocked"
    const availableAtMs = status === "available" ? elapsedMs : null

    lods.push({
      level: lod.level,
      label: lod.label,
      triangles: lod.triangles,
      payloadBytes: stagePayloadBytes,
      packetCount: sizes.length,
      firstAttemptLostPackets: firstAttemptLostIndexes.length,
      remainingLostPackets: remainingLostIndexes.length,
      transmittedBytes: stagePayloadBytes + retryBytes,
      completedAtMs: elapsedMs,
      availableAtMs,
      status,
    })

    previousLevelAvailable = status === "available"
  }

  const availableLods = lods.filter((lod) => lod.status === "available")
  const bestAvailable = availableLods.at(-1) ?? null
  const fullDetail = lods.at(-1)

  return {
    lods,
    firstRenderableMs: availableLods[0]?.availableAtMs ?? null,
    fullDetailMs: fullDetail?.status === "available" ? fullDetail.availableAtMs : null,
    bestAvailableLevel: bestAvailable?.level ?? null,
    bestTriangles: bestAvailable?.triangles ?? 0,
    payloadBytes,
    wireBytes,
  }
}
