import {describe, expect, test} from "bun:test"
import {
  chunkLodScenarioRoutes,
  simulateChunkLodPromotion,
} from "./chunk-lod-promotion"

describe("progressive chunk LOD promotion", () => {
  test("dependent refinements make a cold stationary world renderable before direct target generation", () => {
    const direct = simulateChunkLodPromotion({
      strategy: "direct",
      route: chunkLodScenarioRoutes.stationary,
      warmStart: false,
    })
    const dependent = simulateChunkLodPromotion({
      strategy: "dependent-refinements",
      route: chunkLodScenarioRoutes.stationary,
      warmStart: false,
    })

    expect(direct.averageFirstRenderableMs).not.toBeNull()
    expect(dependent.averageFirstRenderableMs).not.toBeNull()
    expect(dependent.averageFirstRenderableMs!).toBeLessThan(direct.averageFirstRenderableMs!)
  })

  test("dependent refinements reach the same stationary targets without extra generation work", () => {
    const direct = simulateChunkLodPromotion({
      strategy: "direct",
      route: chunkLodScenarioRoutes.stationary,
      warmStart: false,
    })
    const dependent = simulateChunkLodPromotion({
      strategy: "dependent-refinements",
      route: chunkLodScenarioRoutes.stationary,
      warmStart: false,
    })

    expect(dependent.generatedWorkMs).toBe(direct.generatedWorkMs)
    expect(dependent.discardedWorkMs).toBe(0)
    expect(direct.discardedWorkMs).toBe(0)
  })

  test("independent checkpoints trade additional work and memory for intermediate availability", () => {
    const direct = simulateChunkLodPromotion({
      strategy: "direct",
      route: chunkLodScenarioRoutes.stationary,
      warmStart: false,
    })
    const independent = simulateChunkLodPromotion({
      strategy: "independent-checkpoints",
      route: chunkLodScenarioRoutes.stationary,
      warmStart: false,
    })

    expect(independent.averageFirstRenderableMs).not.toBeNull()
    expect(direct.averageFirstRenderableMs).not.toBeNull()
    expect(independent.averageFirstRenderableMs!).toBeLessThan(direct.averageFirstRenderableMs!)
    expect(independent.generatedWorkMs).toBeGreaterThan(direct.generatedWorkMs)
    expect(independent.peakRetainedEntries).toBeGreaterThan(direct.peakRetainedEntries)
    expect(independent.peakRetainedBytes).toBeGreaterThan(direct.peakRetainedBytes)
  })

  test("steady traversal reuses visible lower LODs while higher detail is pending", () => {
    const dependent = simulateChunkLodPromotion({
      strategy: "dependent-refinements",
      route: chunkLodScenarioRoutes.steady,
      movementIntervalMs: 35,
      warmStart: true,
    })

    expect(dependent.promotions).toBeGreaterThan(0)
    expect(dependent.steps.some((step) => step.firstRenderableMs === 0)).toBe(true)
    expect(dependent.completedTasks).toBeGreaterThan(0)
  })

  test("rapid direction changes create measurable discarded or cancelled refinement work", () => {
    const dependent = simulateChunkLodPromotion({
      strategy: "dependent-refinements",
      route: chunkLodScenarioRoutes.reversal,
      movementIntervalMs: 8,
      warmStart: true,
    })

    expect(dependent.discardedWorkMs + dependent.cancelledQueuedWorkMs).toBeGreaterThan(0)
  })

  test("progressive scenarios remain exactly deterministic", () => {
    const input = {
      strategy: "independent-checkpoints" as const,
      route: chunkLodScenarioRoutes.reversal,
      movementIntervalMs: 15,
      warmStart: true,
    }

    expect(simulateChunkLodPromotion(input)).toEqual(simulateChunkLodPromotion(input))
  })
})
