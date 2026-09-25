import {describe, expect, test} from "bun:test"
import {simulateSpatialWorldStreaming} from "./spatial-world-streaming"

const oneChunkEast = [
  [0, 0],
  [1, 0],
] as const

describe("spatial worker lanes", () => {
  test("one explicit lane preserves the original scheduler result", () => {
    const input = {
      strategy: "view" as const,
      boundaryPolicy: "retain" as const,
      movementIntervalMs: 35,
    }

    expect(simulateSpatialWorldStreaming({...input, workerLanes: 1})).toEqual(
      simulateSpatialWorldStreaming(input),
    )
  })

  test("additional lanes reduce near-field head-of-line delay", () => {
    const common = {
      strategy: "view" as const,
      boundaryPolicy: "retain" as const,
      movementIntervalMs: 40,
      route: oneChunkEast,
    }
    const single = simulateSpatialWorldStreaming({...common, workerLanes: 1})
    const dual = simulateSpatialWorldStreaming({...common, workerLanes: 2})
    const quad = simulateSpatialWorldStreaming({...common, workerLanes: 4})

    expect(single.averageNearFieldCompleteMs).not.toBeNull()
    expect(dual.averageNearFieldCompleteMs).not.toBeNull()
    expect(quad.averageNearFieldCompleteMs).not.toBeNull()
    expect(dual.averageNearFieldCompleteMs!).toBeLessThan(single.averageNearFieldCompleteMs!)
    expect(quad.averageNearFieldCompleteMs!).toBeLessThan(dual.averageNearFieldCompleteMs!)
    expect(quad.durationMs).toBeLessThan(single.durationMs)
  })

  test("worker occupancy stays inside the configured lane bound", () => {
    for (const workerLanes of [1, 2, 4]) {
      const result = simulateSpatialWorldStreaming({
        strategy: "view",
        boundaryPolicy: "retain",
        movementIntervalMs: 20,
        workerLanes,
      })

      expect(result.maxBusyWorkers).toBeLessThanOrEqual(workerLanes)
      expect(result.maxBusyWorkers).toBe(workerLanes)
      expect(result.workerUtilizationPercent).toBeGreaterThan(0)
      expect(result.workerUtilizationPercent).toBeLessThanOrEqual(100)
    }
  })

  test("multi-lane scheduling is exactly deterministic", () => {
    const input = {
      strategy: "movement" as const,
      boundaryPolicy: "retain" as const,
      movementIntervalMs: 18,
      workerLanes: 4,
    }

    expect(simulateSpatialWorldStreaming(input)).toEqual(simulateSpatialWorldStreaming(input))
  })

  test("rejects an unbounded worker-lane request", () => {
    expect(() =>
      simulateSpatialWorldStreaming({
        strategy: "view",
        boundaryPolicy: "retain",
        workerLanes: 0,
      }),
    ).toThrow("worker lanes must be an integer from 1 to 8")

    expect(() =>
      simulateSpatialWorldStreaming({
        strategy: "view",
        boundaryPolicy: "retain",
        workerLanes: 9,
      }),
    ).toThrow("worker lanes must be an integer from 1 to 8")
  })
})
