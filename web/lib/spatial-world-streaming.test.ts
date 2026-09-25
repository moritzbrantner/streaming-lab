import {describe, expect, test} from "bun:test"
import {
  planSpatialView,
  simulateSpatialWorldStreaming,
  WORLDGEN_CACHE_LIMIT,
  worldgenSquareTraversal,
} from "./spatial-world-streaming"

describe("spatial world streaming", () => {
  test("matches the WorldGen 7x7 LOD and near-field shape", () => {
    const plan = planSpatialView({
      center: [0, 0],
      movement: [1, 0],
      view: [1, 0],
      strategy: "distance",
    })

    expect(plan).toHaveLength(49)
    expect(plan.filter((chunk) => chunk.collision)).toHaveLength(9)
    expect(plan.filter((chunk) => chunk.resolution === 32)).toHaveLength(9)
    expect(plan.filter((chunk) => chunk.resolution === 16)).toHaveLength(16)
    expect(plan.filter((chunk) => chunk.resolution === 8)).toHaveLength(24)
  })

  test("movement-aware priority favors equally distant chunks ahead of travel", () => {
    const plan = planSpatialView({
      center: [0, 0],
      movement: [1, 0],
      view: [0, 1],
      strategy: "movement",
    })
    const east = plan.find((chunk) => chunk.x === 3 && chunk.z === 0)
    const west = plan.find((chunk) => chunk.x === -3 && chunk.z === 0)

    expect(east).toBeDefined()
    expect(west).toBeDefined()
    expect(east!.priority).toBeLessThan(west!.priority)
    expect(plan.indexOf(east!)).toBeLessThan(plan.indexOf(west!))
  })

  test("view-aware priority favors equally distant chunks inside the forward view", () => {
    const plan = planSpatialView({
      center: [0, 0],
      movement: [1, 0],
      view: [0, 1],
      strategy: "view",
    })
    const front = plan.find((chunk) => chunk.x === 0 && chunk.z === 3)
    const back = plan.find((chunk) => chunk.x === 0 && chunk.z === -3)

    expect(front).toBeDefined()
    expect(back).toBeDefined()
    expect(front!.viewFacing).toBe(true)
    expect(back!.viewFacing).toBe(false)
    expect(front!.priority).toBeLessThan(back!.priority)
  })

  test("retains useful queued work across one-chunk movement", () => {
    const result = simulateSpatialWorldStreaming({
      strategy: "movement",
      boundaryPolicy: "retain",
      movementIntervalMs: 25,
      route: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    })

    expect(result.retainedTasks).toBeGreaterThan(0)
    expect(result.steps[1]?.retainedTasks).toBeGreaterThan(0)
  })

  test("retaining work avoids restart-on-boundary stale generation", () => {
    const common = {
      strategy: "movement" as const,
      movementIntervalMs: 25,
      route: worldgenSquareTraversal,
    }
    const restart = simulateSpatialWorldStreaming({...common, boundaryPolicy: "restart"})
    const retain = simulateSpatialWorldStreaming({...common, boundaryPolicy: "retain"})

    expect(restart.retainedTasks).toBe(0)
    expect(retain.retainedTasks).toBeGreaterThan(0)
    expect(retain.staleCompletions).toBeLessThan(restart.staleCompletions)
    expect(retain.wastedGenerationMs).toBeLessThan(restart.wastedGenerationMs)
  })

  test("keeps cache and pending work structurally bounded", () => {
    const result = simulateSpatialWorldStreaming({
      strategy: "view",
      boundaryPolicy: "retain",
      movementIntervalMs: 40,
    })

    expect(result.maxCacheSize).toBeLessThanOrEqual(WORLDGEN_CACHE_LIMIT)
    expect(result.maxQueueDepth).toBeLessThanOrEqual(50)
    expect(result.cacheHits).toBeGreaterThan(0)
  })

  test("is exactly deterministic for the same traversal inputs", () => {
    const input = {
      strategy: "view" as const,
      boundaryPolicy: "retain" as const,
      movementIntervalMs: 55,
    }

    expect(simulateSpatialWorldStreaming(input)).toEqual(simulateSpatialWorldStreaming(input))
  })
})
