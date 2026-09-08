import {describe, expect, test} from "bun:test"
import {simulateQueuePressure} from "./queue-pressure"

describe("queue pressure", () => {
  test("pause policy uses high/low watermark hysteresis without dropping", () => {
    const result = simulateQueuePressure({
      producerRate: 70,
      consumerRate: 30,
      capacity: 40,
      lowWatermarkPercent: 35,
      highWatermarkPercent: 75,
      policy: "pause",
    })

    expect(result.peakOccupancy).toBeLessThanOrEqual(result.highWatermark)
    expect(result.totalBlocked).toBeGreaterThan(0)
    expect(result.totalDroppedIncoming).toBe(0)
    expect(result.totalEvictedQueued).toBe(0)
    expect(result.pressureTransitions).toBeGreaterThan(1)
  })

  test("drop-newest preserves queued work instead of blocking upstream", () => {
    const result = simulateQueuePressure({
      producerRate: 70,
      consumerRate: 30,
      capacity: 40,
      lowWatermarkPercent: 35,
      highWatermarkPercent: 75,
      policy: "drop-newest",
    })

    expect(result.peakOccupancy).toBeLessThanOrEqual(result.highWatermark)
    expect(result.totalBlocked).toBe(0)
    expect(result.totalDroppedIncoming).toBeGreaterThan(0)
    expect(result.totalEvictedQueued).toBe(0)
  })

  test("drop-oldest evicts backlog to favor fresher work", () => {
    const result = simulateQueuePressure({
      producerRate: 70,
      consumerRate: 30,
      capacity: 40,
      lowWatermarkPercent: 35,
      highWatermarkPercent: 75,
      policy: "drop-oldest",
    })

    expect(result.peakOccupancy).toBeLessThanOrEqual(result.highWatermark)
    expect(result.totalBlocked).toBe(0)
    expect(result.totalEvictedQueued).toBeGreaterThan(0)
  })

  test("rejects inverted watermarks", () => {
    expect(() =>
      simulateQueuePressure({
        producerRate: 20,
        consumerRate: 20,
        capacity: 40,
        lowWatermarkPercent: 80,
        highWatermarkPercent: 60,
        policy: "pause",
      }),
    ).toThrow("invalid queue-pressure simulation input")
  })
})
