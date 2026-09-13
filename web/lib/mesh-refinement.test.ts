import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, test} from "bun:test"
import {decodeEmbeddedGltf, inspectMeshGeometry, type MeshGeometry} from "./object-asset"
import {
  applyMeshRefinement,
  canonicalMeshBytes,
  compressMeshRefinementPackage,
  parseMeshRefinementPackage,
  parseRefinementManifest,
  serializeMeshRefinementPackage,
  type RefinementDeltaEntry,
} from "./mesh-refinement"

const assetDirectory = new URL("../public/assets/object-refinement/", import.meta.url)

function geometrySha256(geometry: MeshGeometry) {
  return createHash("sha256").update(canonicalMeshBytes(geometry)).digest("hex")
}

async function readVerifiedPackage(entry: RefinementDeltaEntry) {
  const text = await readFile(new URL(entry.file, assetDirectory), "utf8")
  expect(Buffer.byteLength(text)).toBe(entry.byteLength)
  expect(createHash("sha256").update(text).digest("hex")).toBe(entry.sha256)
  return {text, refinement: parseMeshRefinementPackage(text)}
}

async function verifyChain(entries: RefinementDeltaEntry[], checkpoints: MeshGeometry[]) {
  let current = checkpoints[0]
  let currentSha256 = geometrySha256(current)
  for (const entry of entries) {
    const {refinement} = await readVerifiedPackage(entry)
    expect(refinement.fromLevel).toBe(entry.fromLevel)
    expect(refinement.toLevel).toBe(entry.toLevel)
    expect(refinement.baseGeometrySha256).toBe(entry.baseGeometrySha256)
    expect(refinement.resultGeometrySha256).toBe(entry.resultGeometrySha256)

    current = applyMeshRefinement(current, refinement, currentSha256)
    currentSha256 = geometrySha256(current)
    expect(currentSha256).toBe(entry.resultGeometrySha256)
    expect(canonicalMeshBytes(current)).toEqual(canonicalMeshBytes(checkpoints[entry.toLevel]))
  }
  return currentSha256
}

describe("mesh refinement packages", () => {
  test("plain and compressed chains reconstruct the same exact checkpoints", async () => {
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

    expect(await verifyChain(manifest.refinements, checkpoints)).toBe(manifest.sourceGeometrySha256)
    expect(await verifyChain(manifest.compressedRefinements, checkpoints)).toBe(manifest.sourceGeometrySha256)
  })

  test("compressed packages are deterministic encodings of the plain refinements", async () => {
    const manifest = parseRefinementManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))

    for (let index = 0; index < manifest.refinements.length; index += 1) {
      const plain = await readVerifiedPackage(manifest.refinements[index])
      const compressed = await readVerifiedPackage(manifest.compressedRefinements[index])
      if (plain.refinement.schemaVersion !== 1) throw new Error("expected a plain refinement package")

      expect(serializeMeshRefinementPackage(compressMeshRefinementPackage(plain.refinement))).toBe(compressed.text)
      expect(manifest.compressedRefinements[index].byteLength).toBeLessThan(manifest.refinements[index].byteLength)
    }
  })

  test("a later delta cannot be applied when an intermediate refinement is missing", async () => {
    const manifest = parseRefinementManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))
    const base = decodeEmbeddedGltf(await readFile(new URL(manifest.checkpoints[0].file, assetDirectory), "utf8"))

    for (const entries of [manifest.refinements, manifest.compressedRefinements]) {
      const later = parseMeshRefinementPackage(await readFile(new URL(entries[1].file, assetDirectory), "utf8"))
      expect(() => applyMeshRefinement(base, later, geometrySha256(base))).toThrow(
        "refinement base geometry fingerprint mismatch",
      )
    }
  })

  test("compressed varints reject non-canonical aliases", async () => {
    const manifest = parseRefinementManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))
    const base = decodeEmbeddedGltf(await readFile(new URL(manifest.checkpoints[0].file, assetDirectory), "utf8"))
    const compressed = parseMeshRefinementPackage(
      await readFile(new URL(manifest.compressedRefinements[0].file, assetDirectory), "utf8"),
    )
    if (compressed.schemaVersion !== 2) throw new Error("expected a compressed refinement package")

    const malformed = {...compressed, indices: "gAA="}
    expect(() => applyMeshRefinement(base, malformed, geometrySha256(base))).toThrow("varint is not canonical")
  })
})
