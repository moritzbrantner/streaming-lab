import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, test} from "bun:test"
import {decodeEmbeddedGltf, inspectMeshGeometry, type MeshGeometry} from "./object-asset"
import {
  applyMeshRefinement,
  canonicalMeshBytes,
  parseMeshRefinementPackage,
  parseRefinementManifest,
} from "./mesh-refinement"

const assetDirectory = new URL("../public/assets/object-refinement/", import.meta.url)

function geometrySha256(geometry: MeshGeometry) {
  return createHash("sha256").update(canonicalMeshBytes(geometry)).digest("hex")
}

describe("mesh refinement packages", () => {
  test("the committed deltas reconstruct the same states as full checkpoints", async () => {
    const manifest = parseRefinementManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))
    const checkpoints: MeshGeometry[] = []

    for (const entry of manifest.checkpoints) {
      const text = await readFile(new URL(entry.file, assetDirectory), "utf8")
      expect(Buffer.byteLength(text)).toBe(entry.byteLength)
      expect(createHash("sha256").update(text).digest("hex")).toBe(entry.sha256)

      const geometry = decodeEmbeddedGltf(text)
      expect(inspectMeshGeometry(geometry)).toEqual({vertices: entry.vertices, triangles: entry.triangles})
      expect(geometrySha256(geometry)).toBe(entry.geometrySha256)
      checkpoints.push(geometry)
    }

    let current = checkpoints[0]
    let currentSha256 = geometrySha256(current)
    for (const entry of manifest.refinements) {
      const text = await readFile(new URL(entry.file, assetDirectory), "utf8")
      expect(Buffer.byteLength(text)).toBe(entry.byteLength)
      expect(createHash("sha256").update(text).digest("hex")).toBe(entry.sha256)

      const refinement = parseMeshRefinementPackage(text)
      expect(refinement.fromLevel).toBe(entry.fromLevel)
      expect(refinement.toLevel).toBe(entry.toLevel)
      expect(refinement.baseGeometrySha256).toBe(entry.baseGeometrySha256)
      expect(refinement.resultGeometrySha256).toBe(entry.resultGeometrySha256)

      current = applyMeshRefinement(current, refinement, currentSha256)
      currentSha256 = geometrySha256(current)
      expect(currentSha256).toBe(entry.resultGeometrySha256)
      expect(canonicalMeshBytes(current)).toEqual(canonicalMeshBytes(checkpoints[entry.toLevel]))
    }

    expect(currentSha256).toBe(manifest.sourceGeometrySha256)
  })

  test("a later delta cannot be applied when an intermediate refinement is missing", async () => {
    const manifest = parseRefinementManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))
    const base = decodeEmbeddedGltf(await readFile(new URL(manifest.checkpoints[0].file, assetDirectory), "utf8"))
    const later = parseMeshRefinementPackage(
      await readFile(new URL(manifest.refinements[1].file, assetDirectory), "utf8"),
    )

    expect(() => applyMeshRefinement(base, later, geometrySha256(base))).toThrow(
      "refinement base geometry fingerprint mismatch",
    )
  })

  test("delta packages use fewer bytes than resending their destination checkpoints", async () => {
    const manifest = parseRefinementManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))

    for (const refinement of manifest.refinements) {
      expect(refinement.byteLength).toBeLessThan(manifest.checkpoints[refinement.toLevel].byteLength)
    }
  })
})
