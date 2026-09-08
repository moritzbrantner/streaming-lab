export type QueuePressurePolicy = "pause" | "drop-newest" | "drop-oldest"

export type QueuePressureInput = {
  producerRate: number
  consumerRate: number
  capacity: number
  lowWatermarkPercent: number
  highWatermarkPercent: number
  policy: QueuePressurePolicy
  durationSeconds?: number
  stepMs?: number
}

export type QueuePressureSample = {
  timeSeconds: number
  occupancy: number
  pressured: boolean
  producerPaused: boolean
  blockedInStep: number
  droppedIncomingInStep: number
  evictedQueuedInStep: number
}

export type QueuePressureResult = {
  samples: QueuePressureSample[]
  totalOffered: number
  totalConsumed: number
  totalBlocked: number
  totalDroppedIncoming: number
  totalEvictedQueued: number
  peakOccupancy: number
  pressureTransitions: number
  lowWatermark: number
  highWatermark: number
}

export function simulateQueuePressure({
  producerRate,
  consumerRate,
  capacity,
  lowWatermarkPercent,
  highWatermarkPercent,
  policy,
  durationSeconds = 6,
  stepMs = 100,
}: QueuePressureInput): QueuePressureResult {
  if (
    producerRate < 0 ||
    consumerRate < 0 ||
    capacity <= 0 ||
    durationSeconds <= 0 ||
    stepMs <= 0 ||
    lowWatermarkPercent < 0 ||
    highWatermarkPercent > 100 ||
    lowWatermarkPercent >= highWatermarkPercent
  ) {
    throw new Error("invalid queue-pressure simulation input")
  }

  const stepSeconds = stepMs / 1000
  const steps = Math.ceil((durationSeconds * 1000) / stepMs)
  const lowWatermark = capacity * (lowWatermarkPercent / 100)
  const highWatermark = capacity * (highWatermarkPercent / 100)
  const samples: QueuePressureSample[] = []

  let occupancy = 0
  let producerPaused = false
  let totalOffered = 0
  let totalConsumed = 0
  let totalBlocked = 0
  let totalDroppedIncoming = 0
  let totalEvictedQueued = 0
  let peakOccupancy = 0
  let pressureTransitions = 0
  let wasPressured = false

  for (let index = 0; index < steps; index += 1) {
    if (policy === "pause" && producerPaused && occupancy <= lowWatermark + Number.EPSILON) {
      producerPaused = false
    }

    const wanted = producerRate * stepSeconds
    totalOffered += wanted

    let blockedInStep = 0
    let droppedIncomingInStep = 0
    let evictedQueuedInStep = 0

    if (policy === "pause") {
      if (producerPaused) {
        blockedInStep = wanted
      } else {
        const accepted = Math.min(wanted, Math.max(0, highWatermark - occupancy))
        occupancy += accepted
        blockedInStep = wanted - accepted

        if (occupancy + Number.EPSILON >= highWatermark) {
          producerPaused = true
        }
      }
    } else if (policy === "drop-newest") {
      const accepted = Math.min(wanted, Math.max(0, highWatermark - occupancy))
      occupancy += accepted
      droppedIncomingInStep = wanted - accepted
    } else {
      const queuedBeforeProduction = occupancy
      occupancy += wanted

      const excess = Math.max(0, occupancy - highWatermark)
      evictedQueuedInStep = Math.min(excess, queuedBeforeProduction)
      droppedIncomingInStep = excess - evictedQueuedInStep
      occupancy -= excess
    }

    peakOccupancy = Math.max(peakOccupancy, occupancy)

    const consumeBudget = consumerRate * stepSeconds
    const consumed = Math.min(occupancy, consumeBudget)
    occupancy -= consumed

    totalConsumed += consumed
    totalBlocked += blockedInStep
    totalDroppedIncoming += droppedIncomingInStep
    totalEvictedQueued += evictedQueuedInStep

    const pressured =
      producerPaused ||
      blockedInStep > Number.EPSILON ||
      droppedIncomingInStep > Number.EPSILON ||
      evictedQueuedInStep > Number.EPSILON

    if (pressured !== wasPressured) {
      pressureTransitions += 1
      wasPressured = pressured
    }

    samples.push({
      timeSeconds: (index + 1) * stepSeconds,
      occupancy,
      pressured,
      producerPaused,
      blockedInStep,
      droppedIncomingInStep,
      evictedQueuedInStep,
    })
  }

  return {
    samples,
    totalOffered,
    totalConsumed,
    totalBlocked,
    totalDroppedIncoming,
    totalEvictedQueued,
    peakOccupancy,
    pressureTransitions,
    lowWatermark,
    highWatermark,
  }
}
