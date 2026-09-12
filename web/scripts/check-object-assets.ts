import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {decodeEmbeddedGltf, inspectMeshGeometry, parseObjectAssetManifest} from "../lib/object-asset"

const assetDirectory = new URL("../public/assets/object-streaming/", import.meta.url)
const manifestText = await readFile(new URL("manifest.json", assetDirectory), "utf8")
const manifest = parseObjectAssetManifest(manifestText)

for (const entry of manifest.lods) {
  const assetText = await readFile(new URL(entry.file, assetDirectory), "utf8")
  const byteLength = Buffer.byteLength(assetText)
  if (byteLength !== entry.byteLength) {
    throw new Error(`${entry.file}: expected ${entry.byteLength} bytes, got ${byteLength}`)
  }

  const digest = createHash("sha256").update(assetText).digest("hex")
  if (digest !== entry.sha256) {
    throw new Error(`${entry.file}: SHA-256 does not match the manifest`)
  }

  const summary = inspectMeshGeometry(decodeEmbeddedGltf(assetText))
  if (summary.vertices !== entry.vertices || summary.triangles !== entry.triangles) {
    throw new Error(
      `${entry.file}: manifest geometry is ${entry.vertices} vertices/${entry.triangles} triangles, ` +
        `asset is ${summary.vertices} vertices/${summary.triangles} triangles`,
    )
  }
}

console.log(`verified ${manifest.lods.length} independently addressable glTF LOD packages for ${manifest.asset}`)
