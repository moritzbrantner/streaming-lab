import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {decodeEmbeddedGltf, type MeshGeometry} from "../lib/object-asset"
import {
  applyMeshRefinement,
  canonicalMeshBytes,
  compressMeshRefinementPackage,
  parseMeshRefinementPackage,
  parseRefinementManifest,
  serializeMeshRefinementPackage,
  type RefinementDeltaEntry,
} from "../lib/mesh-refinement"

const assetDirectory = new URL("../public/assets/object-refinement/", import.meta.url)
const manifest = parseRefinementManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))

function sha256Text(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function sha256Geometry(geometry: MeshGeometry) {
  return createHash("sha256").update(canonicalMeshBytes(geometry)).digest("hex")
}

async function readVerifiedPackage(entry: RefinementDeltaEntry) {
  const text = await readFile(new URL(entry.file, assetDirectory), "utf8")
  if (Buffer.byteLength(text) !== entry.byteLength) throw new Error(`${entry.file}: byte length mismatch`)
  if (sha256Text(text) !== entry.sha256) throw new Error(`${entry.file}: package SHA-256 mismatch`)
  return {text, refinement: parseMeshRefinementPackage(text)}
}

const checkpointGeometry: MeshGeometry[] = []
for (const entry of manifest.checkpoints) {
  const text = await readFile(new URL(entry.file, assetDirectory), "utf8")
  if (Buffer.byteLength(text) !== entry.byteLength) throw new Error(`${entry.file}: byte length mismatch`)
  if (sha256Text(text) !== entry.sha256) throw new Error(`${entry.file}: package SHA-256 mismatch`)

  const geometry = decodeEmbeddedGltf(text)
  if (sha256Geometry(geometry) !== entry.geometrySha256) {
    throw new Error(`${entry.file}: geometry SHA-256 mismatch`)
  }
  checkpointGeometry.push(geometry)
}

async function verifyChain(entries: RefinementDeltaEntry[], label: string) {
  let current = checkpointGeometry[0]
  let currentSha256 = sha256Geometry(current)
  for (const entry of entries) {
    const {refinement} = await readVerifiedPackage(entry)
    if (
      refinement.fromLevel !== entry.fromLevel ||
      refinement.toLevel !== entry.toLevel ||
      refinement.baseGeometrySha256 !== entry.baseGeometrySha256 ||
      refinement.resultGeometrySha256 !== entry.resultGeometrySha256
    ) {
      throw new Error(`${entry.file}: package metadata does not match the manifest`)
    }

    current = applyMeshRefinement(current, refinement, currentSha256)
    currentSha256 = sha256Geometry(current)
    if (currentSha256 !== entry.resultGeometrySha256) {
      throw new Error(`${entry.file}: applied geometry does not match its declared result`)
    }
    const checkpointSha256 = sha256Geometry(checkpointGeometry[entry.toLevel])
    if (currentSha256 !== checkpointSha256) {
      throw new Error(`${entry.file}: ${label} result differs from checkpoint LOD ${entry.toLevel}`)
    }
  }
  if (currentSha256 !== manifest.sourceGeometrySha256) {
    throw new Error(`${label} chain does not reconstruct the source checkpoint`)
  }
}

await verifyChain(manifest.refinements, "plain refinement")
await verifyChain(manifest.compressedRefinements, "compressed refinement")

for (let index = 0; index < manifest.refinements.length; index += 1) {
  const plainEntry = manifest.refinements[index]
  const compressedEntry = manifest.compressedRefinements[index]
  const plain = await readVerifiedPackage(plainEntry)
  const compressed = await readVerifiedPackage(compressedEntry)
  if (plain.refinement.schemaVersion !== 1) throw new Error(`${plainEntry.file}: expected plain refinement encoding`)
  const regenerated = serializeMeshRefinementPackage(compressMeshRefinementPackage(plain.refinement))
  if (regenerated !== compressed.text) {
    throw new Error(`${compressedEntry.file}: committed compressed bytes differ from deterministic codec output`)
  }
  if (compressedEntry.byteLength >= plainEntry.byteLength) {
    throw new Error(`${compressedEntry.file}: compression did not reduce package bytes`)
  }
}

console.log(
  `verified ${manifest.checkpoints.length} checkpoints, ${manifest.refinements.length} plain refinements, and ${manifest.compressedRefinements.length} deterministic compressed refinements for ${manifest.asset}`,
)
