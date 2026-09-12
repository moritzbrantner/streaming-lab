import {describe, expect, test} from "bun:test"
import {simulateObjectStreaming} from "./object-streaming"

describe("progressive 3d object streaming", () => {
  test("a lossless dependent stream renders a proxy before full detail", () => {
    const result = simulateObjectStreaming({
      bandwidthMbps: 8,
      latencyMs: 50,
      lossPercent: 0,
      retry: false,
      strategy: "dependent-refinements",
    })

    expect(result.bestAvailableLevel).toBe(3)
    expect(result.firstRenderableMs).not.toBeNull()
    expect(result.fullDetailMs).not.toBeNull()
    expect(result.firstRenderableMs!).toBeLessThan(result.fullDetailMs!)
    expect(result.payloadBytes).toBe(2_200_000)
  })

  test("dependent refinements keep the last complete LOD when an earlier layer is missing", () => {
    const result = simulateObjectStreaming({
      bandwidthMbps: 8,
      latencyMs: 50,
      lossPercent: 18,
      retry: false,
      strategy: "dependent-refinements",
      seed: 30,
    })

    expect(result.lods[0].status).toBe("available")
    expect(result.lods[1].status).toBe("lost")
    expect(result.lods[2].status).toBe("blocked")
    expect(result.bestAvailableLevel).toBe(0)
    expect(result.bestTriangles).toBe(600)
  })

  test("independent LOD checkpoints can recover after a missing earlier package", () => {
    const result = simulateObjectStreaming({
      bandwidthMbps: 8,
      latencyMs: 50,
      lossPercent: 18,
      retry: false,
      strategy: "independent-lods",
      seed: 30,
    })

    expect(result.lods[0].status).toBe("available")
    expect(result.lods[1].status).toBe("lost")
    expect(result.lods[2].status).toBe("available")
    expect(result.bestAvailableLevel).toBe(2)
  })

  test("independent checkpoints spend more payload bytes than dependent refinements", () => {
    const dependent = simulateObjectStreaming({
      bandwidthMbps: 8,
      latencyMs: 50,
      lossPercent: 0,
      retry: false,
      strategy: "dependent-refinements",
    })
    const independent = simulateObjectStreaming({
      bandwidthMbps: 8,
      latencyMs: 50,
      lossPercent: 0,
      retry: false,
      strategy: "independent-lods",
    })

    expect(independent.payloadBytes).toBeGreaterThan(dependent.payloadBytes)
  })
})
