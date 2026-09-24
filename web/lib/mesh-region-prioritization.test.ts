import {readFile} from "node:fs/promises"
import {describe, expect, test} from "bun:test"
import {decodeEmbeddedGltf} from "./object-asset"
import {partitionMeshRegions, simulateMeshRegionStreaming} from "./mesh-region-prioritization"

const detailAsset = new URL("../public/assets/object-refinement/detail.gltf", import.meta.url)

async function detailPartition() {
  const geometry = decodeEmbeddedGltf(await readFile(detailAsset, "utf8"))
  return partitionMeshRegions(geometry)
}

describe("mesh region prioritization", () => {
  test("partitions every triangle of the verified detail asset deterministically", async () => {
    const partition = await detailPartition()

    expect(partition.triangleCount).toBe(128)
    expect(partition.vertexCount).toBe(66)
    expect(partition.monolithicPayloadBytes).toBe(1560)
    expect(partition.regionPayloadBytes).toBe(1992)
    expect(partition.regions.map((region) => ({
      id: region.id,
      triangles: region.triangleCount,
      vertices: region.vertexCount,
      bytes: region.payloadBytes,
      firstTriangle: region.firstTriangle,
    }))).toEqual([
      {id: "right", triangles: 28, vertices: 21, bytes: 420, firstTriangle: 0},
      {id: "top", triangles: 20, vertices: 17, bytes: 324, firstTriangle: 4},
      {id: "front", triangles: 16, vertices: 13, bytes: 252, firstTriangle: 8},
      {id: "left", triangles: 28, vertices: 21, bytes: 420, firstTriangle: 20},
      {id: "bottom", triangles: 20, vertices: 17, bytes: 324, firstTriangle: 36},
      {id: "back", triangles: 16, vertices: 13, bytes: 252, firstTriangle: 72},
    ])
  })

  test("view priority advances useful front-facing detail without changing total work", async () => {
    const partition = await detailPartition()
    const common = {
      partition,
      cameraPosition: [0, 0, 4] as [number, number, number],
      bandwidthMbps: 8,
      latencyMs: 40,
      budgetMs: 100,
    }
    const sourceOrder = simulateMeshRegionStreaming({...common, strategy: "source-order"})
    const viewPriority = simulateMeshRegionStreaming({...common, strategy: "view-priority"})

    expect(sourceOrder.deliveries.map((delivery) => delivery.id)).toEqual([
      "right", "top", "front", "left", "bottom", "back",
    ])
    expect(viewPriority.deliveries.map((delivery) => delivery.id)).toEqual([
      "front", "right", "left", "top", "bottom", "back",
    ])
    expect(sourceOrder.firstVisibleMs).toBeCloseTo(120.996)
    expect(viewPriority.firstVisibleMs).toBeCloseTo(40.252)
    expect(sourceOrder.visibleTrianglesWithinBudget).toBe(0)
    expect(viewPriority.visibleTrianglesWithinBudget).toBe(16)
    expect(sourceOrder.payloadBytes).toBe(viewPriority.payloadBytes)
    expect(sourceOrder.duplicatedBytes).toBe(432)
    expect(sourceOrder.completeMs).toBe(viewPriority.completeMs)
  })

  test("camera position changes which real mesh region is prioritized", async () => {
    const partition = await detailPartition()
    const result = simulateMeshRegionStreaming({
      partition,
      cameraPosition: [-4, 0, 0],
      bandwidthMbps: 8,
      latencyMs: 40,
      budgetMs: 100,
      strategy: "view-priority",
    })

    expect(result.deliveries[0]?.id).toBe("left")
    expect(result.deliveries[0]?.viewFacing).toBe(true)
    expect(result.visibleTrianglesWithinBudget).toBe(28)
  })

  test("rejects invalid timing inputs before scheduling", async () => {
    const partition = await detailPartition()
    expect(() => simulateMeshRegionStreaming({
      partition,
      cameraPosition: [0, 0, 4],
      bandwidthMbps: 0,
      latencyMs: 40,
      budgetMs: 100,
      strategy: "view-priority",
    })).toThrow("invalid mesh region streaming input")
  })
})
