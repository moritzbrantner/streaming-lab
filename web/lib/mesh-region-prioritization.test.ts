import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, test} from "bun:test"
import {decodeEmbeddedGltf} from "./object-asset"
import {canonicalMeshBytes} from "./mesh-refinement"
import {
  decodeMeshRegionPackage,
  materializeMeshRegionPackages,
  parseMeshRegionManifest,
  parseMeshRegionPackage,
  partitionMeshRegionManifest,
  partitionMeshRegions,
  serializeMeshRegionPackage,
  serializeMeshRegionProvenance,
  simulateMeshRegionStreaming,
} from "./mesh-region-prioritization"

const detailAsset = new URL("../public/assets/object-refinement/detail.gltf", import.meta.url)
const regionAssetDirectory = new URL("../public/assets/object-regions/", import.meta.url)

function geometrySha256(geometry: ReturnType<typeof decodeEmbeddedGltf>) {
  return createHash("sha256").update(canonicalMeshBytes(geometry)).digest("hex")
}

async function detailGeometry() {
  return decodeEmbeddedGltf(await readFile(detailAsset, "utf8"))
}

describe("mesh region prioritization", () => {
  test("partitions every triangle of the verified detail asset deterministically", async () => {
    const partition = partitionMeshRegions(await detailGeometry())

    expect(partition.triangleCount).toBe(128)
    expect(partition.vertexCount).toBe(66)
    expect(partition.monolithicGeometryBytes).toBe(1560)
    expect(partition.regionGeometryBytes).toBe(1992)
    expect(partition.monolithicPackageBytes).toBe(1560)
    expect(partition.regionPackageBytes).toBe(1992)
    expect(partition.regions.map((region) => ({
      id: region.id,
      triangles: region.triangleCount,
      vertices: region.vertexCount,
      geometryBytes: region.geometryBytes,
      packageBytes: region.packageBytes,
      firstTriangle: region.firstTriangle,
    }))).toEqual([
      {id: "right", triangles: 28, vertices: 21, geometryBytes: 420, packageBytes: 420, firstTriangle: 0},
      {id: "top", triangles: 20, vertices: 17, geometryBytes: 324, packageBytes: 324, firstTriangle: 4},
      {id: "front", triangles: 16, vertices: 13, geometryBytes: 252, packageBytes: 252, firstTriangle: 8},
      {id: "left", triangles: 28, vertices: 21, geometryBytes: 420, packageBytes: 420, firstTriangle: 20},
      {id: "bottom", triangles: 20, vertices: 17, geometryBytes: 324, packageBytes: 324, firstTriangle: 36},
      {id: "back", triangles: 16, vertices: 13, geometryBytes: 252, packageBytes: 252, firstTriangle: 72},
    ])
  })

  test("committed region packages are exact deterministic projections of the source mesh", async () => {
    const source = await detailGeometry()
    const sourceSha256 = geometrySha256(source)
    const generated = materializeMeshRegionPackages(source, sourceSha256)
    const manifest = parseMeshRegionManifest(await readFile(new URL("manifest.json", regionAssetDirectory), "utf8"))

    expect(manifest.sourceGeometrySha256).toBe(sourceSha256)
    expect(manifest.sourceVertices).toBe(source.positions.length)
    expect(manifest.sourceTriangles).toBe(source.indices.length / 3)

    const coveredTriangles: number[] = []
    for (const expectedPackage of generated) {
      const entry = manifest.regions.find((region) => region.id === expectedPackage.region)
      expect(entry).toBeDefined()
      const text = await readFile(new URL(entry!.file, regionAssetDirectory), "utf8")
      expect(Buffer.byteLength(text)).toBe(entry!.byteLength)
      expect(createHash("sha256").update(text).digest("hex")).toBe(entry!.sha256)

      const parsed = parseMeshRegionPackage(text)
      expect(text).toBe(serializeMeshRegionPackage(expectedPackage))
      expect(parsed.sourceGeometrySha256).toBe(sourceSha256)
      expect(createHash("sha256").update(serializeMeshRegionProvenance(parsed)).digest("hex")).toBe(
        entry!.provenanceSha256,
      )
      expect(geometrySha256(decodeMeshRegionPackage(parsed))).toBe(entry!.geometrySha256)
      coveredTriangles.push(...parsed.sourceTriangleIndexes)
    }

    expect(coveredTriangles.toSorted((left, right) => left - right)).toEqual(
      Array.from({length: source.indices.length / 3}, (_, index) => index),
    )
  })

  test("real package bytes preserve priority gains while exposing packaging overhead", async () => {
    const manifest = parseMeshRegionManifest(await readFile(new URL("manifest.json", regionAssetDirectory), "utf8"))
    const partition = partitionMeshRegionManifest(manifest)
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
    expect(sourceOrder.firstVisibleMs).toBeCloseTo(123.984)
    expect(viewPriority.firstVisibleMs).toBeCloseTo(41.007)
    expect(sourceOrder.visibleTrianglesWithinBudget).toBe(0)
    expect(viewPriority.visibleTrianglesWithinBudget).toBe(16)
    expect(sourceOrder.payloadBytes).toBe(8053)
    expect(viewPriority.payloadBytes).toBe(8053)
    expect(sourceOrder.duplicatedBytes).toBe(432)
    expect(sourceOrder.packageOverheadBytes).toBe(5327)
    expect(sourceOrder.completeMs).toBeCloseTo(248.053)
    expect(sourceOrder.completeMs).toBe(viewPriority.completeMs)
  })

  test("camera position changes which real mesh region is prioritized", async () => {
    const manifest = parseMeshRegionManifest(await readFile(new URL("manifest.json", regionAssetDirectory), "utf8"))
    const result = simulateMeshRegionStreaming({
      partition: partitionMeshRegionManifest(manifest),
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
    const partition = partitionMeshRegions(await detailGeometry())
    expect(() => simulateMeshRegionStreaming({
      partition,
      cameraPosition: [0, 0, 4],
      bandwidthMbps: 0,
      latencyMs: 40,
      budgetMs: 100,
      strategy: "view-priority",
    })).toThrow("invalid mesh region streaming input")
  })

  test("rejects malformed package provenance before geometry promotion", async () => {
    const text = await readFile(new URL("region-front.json", regionAssetDirectory), "utf8")
    const value = JSON.parse(text) as Record<string, unknown>
    value.sourceTriangleIndexes = [8, 8]

    expect(() => parseMeshRegionPackage(JSON.stringify(value))).toThrow(
      "mesh region source triangle indexes must be strictly increasing",
    )
  })
})
