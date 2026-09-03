import {describe, expect, test} from "bun:test"
import {
  calculateChunkingMetrics,
  chooseQuality,
  simulateAdaptiveBitrate,
  simulateBuffer,
  simulateNetwork,
} from "./models"

describe("streaming models", () => {
  test("backpressure keeps the buffer bounded and blocks excess production", () => {
    const result = simulateBuffer({producerRate: 80, consumerRate: 20, capacity: 10, durationSeconds: 2})

    expect(result.peakOccupancy).toBeLessThanOrEqual(10)
    expect(result.totalBlocked).toBeGreaterThan(0)
    expect(result.totalConsumed).toBeGreaterThan(0)
  })

  test("larger chunks reduce framing overhead", () => {
    const small = calculateChunkingMetrics(1_000_000, 4_096, 32, 1_000_000)
    const large = calculateChunkingMetrics(1_000_000, 64_000, 32, 1_000_000)

    expect(large.overheadBytes).toBeLessThan(small.overheadBytes)
    expect(large.firstChunkSerializationMs).toBeGreaterThan(small.firstChunkSerializationMs)
  })

  test("a lossless network delivers every packet", () => {
    const result = simulateNetwork({packetCount: 20, lossPercent: 0, jitterMs: 200, retry: false})

    expect(result.delivered).toBe(20)
    expect(result.lost).toBe(0)
  })

  test("quality selection leaves safety headroom", () => {
    expect(chooseQuality(4).label).toBe("720p")
    expect(simulateAdaptiveBitrate(4)).toHaveLength(8)
  })
})
