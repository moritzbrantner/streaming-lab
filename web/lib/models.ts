export type BufferSimulationInput = {
  producerRate: number
  consumerRate: number
  capacity: number
  durationSeconds?: number
  stepMs?: number
}

export type BufferSample = {
  timeSeconds: number
  occupancy: number
}

export type BufferSimulationResult = {
  samples: BufferSample[]
  totalProduced: number
  totalConsumed: number
  totalBlocked: number
  peakOccupancy: number
  starvationSteps: number
}

export function simulateBuffer({
  producerRate,
  consumerRate,
  capacity,
  durationSeconds = 4,
  stepMs = 100,
}: BufferSimulationInput): BufferSimulationResult {
  if (producerRate < 0 || consumerRate < 0 || capacity <= 0 || durationSeconds <= 0 || stepMs <= 0) {
    throw new Error("stream simulation values must be non-negative and capacity/duration/step must be positive")
  }

  const stepSeconds = stepMs / 1000
  const steps = Math.ceil((durationSeconds * 1000) / stepMs)
  const samples: BufferSample[] = []
  let occupancy = 0
  let totalProduced = 0
  let totalConsumed = 0
  let totalBlocked = 0
  let peakOccupancy = 0
  let starvationSteps = 0

  for (let index = 0; index < steps; index += 1) {
    const wanted = producerRate * stepSeconds
    const accepted = Math.min(wanted, Math.max(0, capacity - occupancy))
    const blocked = wanted - accepted
    occupancy += accepted

    const consumeBudget = consumerRate * stepSeconds
    const consumed = Math.min(occupancy, consumeBudget)
    if (consumerRate > 0 && consumed + Number.EPSILON < consumeBudget) {
      starvationSteps += 1
    }
    occupancy -= consumed

    totalProduced += accepted
    totalConsumed += consumed
    totalBlocked += blocked
    peakOccupancy = Math.max(peakOccupancy, occupancy)
    samples.push({timeSeconds: (index + 1) * stepSeconds, occupancy})
  }

  return {samples, totalProduced, totalConsumed, totalBlocked, peakOccupancy, starvationSteps}
}

export type ChunkingMetrics = {
  chunks: number
  overheadBytes: number
  wireBytes: number
  efficiencyPercent: number
  firstChunkSerializationMs: number
}

export function calculateChunkingMetrics(
  payloadBytes: number,
  chunkBytes: number,
  framingBytes: number,
  throughputBytesPerSecond: number,
): ChunkingMetrics {
  if (payloadBytes <= 0 || chunkBytes <= 0 || framingBytes < 0 || throughputBytesPerSecond <= 0) {
    throw new Error("chunking inputs must be positive, except framing which may be zero")
  }

  const chunks = Math.ceil(payloadBytes / chunkBytes)
  const overheadBytes = chunks * framingBytes
  const wireBytes = payloadBytes + overheadBytes
  const firstChunkPayload = Math.min(chunkBytes, payloadBytes)

  return {
    chunks,
    overheadBytes,
    wireBytes,
    efficiencyPercent: (payloadBytes / wireBytes) * 100,
    firstChunkSerializationMs: (firstChunkPayload / throughputBytesPerSecond) * 1000,
  }
}

export type PacketResult = {
  index: number
  status: "delivered" | "retried" | "lost"
  latencyMs: number | null
}

export type NetworkSimulationResult = {
  packets: PacketResult[]
  delivered: number
  lost: number
  retried: number
  averageLatencyMs: number
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function simulateNetwork({
  packetCount = 24,
  lossPercent,
  jitterMs,
  retry,
  baseLatencyMs = 60,
  seed = 42,
}: {
  packetCount?: number
  lossPercent: number
  jitterMs: number
  retry: boolean
  baseLatencyMs?: number
  seed?: number
}): NetworkSimulationResult {
  if (packetCount <= 0 || lossPercent < 0 || lossPercent > 100 || jitterMs < 0 || baseLatencyMs < 0) {
    throw new Error("invalid network simulation input")
  }

  const random = seededRandom(seed)
  const packets: PacketResult[] = []

  for (let index = 0; index < packetCount; index += 1) {
    const firstLost = random() < lossPercent / 100
    const firstLatency = baseLatencyMs + random() * jitterMs

    if (!firstLost) {
      packets.push({index, status: "delivered", latencyMs: firstLatency})
      continue
    }

    if (!retry) {
      packets.push({index, status: "lost", latencyMs: null})
      continue
    }

    const retryLost = random() < lossPercent / 100
    const retryLatency = baseLatencyMs + random() * jitterMs
    packets.push(
      retryLost
        ? {index, status: "lost", latencyMs: null}
        : {index, status: "retried", latencyMs: firstLatency + retryLatency},
    )
  }

  const deliveredPackets = packets.filter((packet) => packet.status !== "lost")
  const latencyTotal = deliveredPackets.reduce((sum, packet) => sum + (packet.latencyMs ?? 0), 0)

  return {
    packets,
    delivered: deliveredPackets.length,
    lost: packets.length - deliveredPackets.length,
    retried: packets.filter((packet) => packet.status === "retried").length,
    averageLatencyMs: deliveredPackets.length === 0 ? 0 : latencyTotal / deliveredPackets.length,
  }
}

export const qualityLevels = [
  {label: "240p", bitrateMbps: 0.35},
  {label: "360p", bitrateMbps: 0.8},
  {label: "720p", bitrateMbps: 2.5},
  {label: "1080p", bitrateMbps: 5},
] as const

export function chooseQuality(throughputMbps: number, safetyFactor = 0.8) {
  if (throughputMbps <= 0 || safetyFactor <= 0 || safetyFactor > 1) {
    throw new Error("throughput and safety factor must be positive")
  }

  const safeThroughput = throughputMbps * safetyFactor
  return [...qualityLevels].reverse().find((quality) => quality.bitrateMbps <= safeThroughput) ?? qualityLevels[0]
}

export function simulateAdaptiveBitrate(baseThroughputMbps: number) {
  if (baseThroughputMbps <= 0) {
    throw new Error("base throughput must be positive")
  }

  const multipliers = [1, 0.72, 1.18, 0.54, 0.9, 1.32, 0.68, 1.05]
  return multipliers.map((multiplier, index) => {
    const throughputMbps = Math.max(0.1, baseThroughputMbps * multiplier)
    const quality = chooseQuality(throughputMbps)
    return {
      index,
      throughputMbps,
      quality,
      atRisk: quality.bitrateMbps > throughputMbps,
    }
  })
}
