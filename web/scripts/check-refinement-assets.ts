import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {decodeEmbeddedGltf, type MeshGeometry} from "../lib/object-asset"
import {
  applyMeshRefinement,
  canonicalMeshBytes,
  parseMeshRefinementPackage,
  parseRefinementManifest,
} from "../lib/mesh-refinement"

const assetDirectory = new URL("../public/assets/object-refinement/", import.meta.url)
const manifest = parseRefinementManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))

function sha256Text(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function sha256Geometry(geometry: MeshGeometry) {
  return createHash("sha256").update(canonicalMeshBytes(geometry)).digest("hex")
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

let current = checkpointGeometry[0]
let currentSha256 = sha256Geometry(current)
for (const entry of manifest.refinements) {
  const text = await readFile(new URL(entry.file, assetDirectory), "utf8")
  if (Buffer.byteLength(text) !== entry.byteLength) throw new Error(`${entry.file}: byte length mismatch`)
  if (sha256Text(text) !== entry.sha256) throw new Error(`${entry.file}: package SHA-256 mismatch`)

  const refinement = parseMeshRefinementPackage(text)
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
    throw new Error(`${entry.file}: delta result differs from checkpoint LOD ${entry.toLevel}`)
  }
}

if (currentSha256 !== manifest.sourceGeometrySha256) {
  throw new Error("refinement chain does not reconstruct the source checkpoint")
}

console.log(
  `verified ${manifest.checkpoints.length} checkpoints and ${manifest.refinements.length} exact mesh refinements for ${manifest.asset}`,
)
