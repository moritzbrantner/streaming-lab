import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {decodeEmbeddedGltf} from "../lib/object-asset"
import {canonicalMeshBytes, parseRefinementManifest} from "../lib/mesh-refinement"
import {
  decodeMeshRegionPackage,
  materializeMeshRegionPackages,
  partitionMeshRegions,
  serializeMeshRegionManifest,
  serializeMeshRegionPackage,
  serializeMeshRegionProvenance,
  type MeshRegionManifest,
} from "../lib/mesh-region-prioritization"

const refinementDirectory = new URL("../public/assets/object-refinement/", import.meta.url)

function sha256Text(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function sha256Geometry(geometry: ReturnType<typeof decodeEmbeddedGltf>) {
  return createHash("sha256").update(canonicalMeshBytes(geometry)).digest("hex")
}

export async function buildMeshRegionAssetSet() {
  const refinementManifest = parseRefinementManifest(
    await readFile(new URL("manifest.json", refinementDirectory), "utf8"),
  )
  const sourceEntry = refinementManifest.checkpoints.at(-1)
  if (sourceEntry === undefined) {
    throw new Error("refinement manifest has no source checkpoint")
  }

  const sourceText = await readFile(new URL(sourceEntry.file, refinementDirectory), "utf8")
  if (Buffer.byteLength(sourceText) !== sourceEntry.byteLength) {
    throw new Error("source checkpoint byte length does not match refinement manifest")
  }
  if (sha256Text(sourceText) !== sourceEntry.sha256) {
    throw new Error("source checkpoint SHA-256 does not match refinement manifest")
  }

  const sourceGeometry = decodeEmbeddedGltf(sourceText)
  const sourceGeometrySha256 = sha256Geometry(sourceGeometry)
  if (
    sourceGeometrySha256 !== sourceEntry.geometrySha256 ||
    sourceGeometrySha256 !== refinementManifest.sourceGeometrySha256
  ) {
    throw new Error("source checkpoint geometry fingerprint does not match refinement manifest")
  }

  const partition = partitionMeshRegions(sourceGeometry)
  const regionPackages = materializeMeshRegionPackages(sourceGeometry, sourceGeometrySha256)
  if (regionPackages.length !== partition.regions.length) {
    throw new Error("region materialization does not match the deterministic partition")
  }

  const files = regionPackages.map((regionPackage, index) => {
    const summary = partition.regions[index]
    if (summary === undefined || summary.id !== regionPackage.region) {
      throw new Error("region package order differs from deterministic partition order")
    }
    const text = serializeMeshRegionPackage(regionPackage)
    const geometry = decodeMeshRegionPackage(regionPackage)
    const geometrySha256 = sha256Geometry(geometry)
    const file = `region-${regionPackage.region}.json`

    return {
      file,
      text,
      entry: {
        id: regionPackage.region,
        file,
        byteLength: Buffer.byteLength(text),
        sha256: sha256Text(text),
        geometrySha256,
        provenanceSha256: sha256Text(serializeMeshRegionProvenance(regionPackage)),
        firstTriangle: summary.firstTriangle,
        triangleCount: summary.triangleCount,
        vertexCount: summary.vertexCount,
        geometryBytes: summary.geometryBytes,
        center: summary.center,
        normal: summary.normal,
      },
    }
  })

  const manifest: MeshRegionManifest = {
    schemaVersion: 1,
    asset: refinementManifest.asset,
    sourceCheckpoint: sourceEntry.file,
    sourceByteLength: sourceEntry.byteLength,
    sourceSha256: sourceEntry.sha256,
    sourceGeometrySha256,
    sourceVertices: sourceGeometry.positions.length,
    sourceTriangles: sourceGeometry.indices.length / 3,
    sourceGeometryBytes: partition.monolithicGeometryBytes,
    regions: files.map(({entry}) => entry),
  }

  return {
    manifest,
    manifestText: serializeMeshRegionManifest(manifest),
    files,
  }
}
