import {readdir, readFile} from "node:fs/promises"
import {
  decodeMeshRegionPackage,
  parseMeshRegionManifest,
  parseMeshRegionPackage,
  partitionMeshRegionManifest,
} from "../lib/mesh-region-prioritization"
import {canonicalMeshBytes} from "../lib/mesh-refinement"
import {createHash} from "node:crypto"
import {buildMeshRegionAssetSet} from "./mesh-region-asset-set"

const outputDirectory = new URL("../public/assets/object-regions/", import.meta.url)
const expected = await buildMeshRegionAssetSet()
const committedManifestText = await readFile(new URL("manifest.json", outputDirectory), "utf8")

if (committedManifestText !== expected.manifestText) {
  throw new Error("mesh region manifest differs from deterministic source-derived output")
}
const manifest = parseMeshRegionManifest(committedManifestText)
const partition = partitionMeshRegionManifest(manifest)
if (partition.regionPackageBytes !== manifest.regions.reduce((total, region) => total + region.byteLength, 0)) {
  throw new Error("mesh region package byte accounting is inconsistent")
}

for (const expectedFile of expected.files) {
  const committedText = await readFile(new URL(expectedFile.file, outputDirectory), "utf8")
  if (committedText !== expectedFile.text) {
    throw new Error(`${expectedFile.file}: committed bytes differ from deterministic source-derived output`)
  }
  const parsed = parseMeshRegionPackage(committedText)
  const manifestEntry = manifest.regions.find((entry) => entry.id === parsed.region)
  if (manifestEntry === undefined) {
    throw new Error(`${expectedFile.file}: package is missing from the manifest`)
  }
  if (Buffer.byteLength(committedText) !== manifestEntry.byteLength) {
    throw new Error(`${expectedFile.file}: byte length does not match the manifest`)
  }
  if (createHash("sha256").update(committedText).digest("hex") !== manifestEntry.sha256) {
    throw new Error(`${expectedFile.file}: SHA-256 does not match the manifest`)
  }
  const geometrySha256 = createHash("sha256")
    .update(canonicalMeshBytes(decodeMeshRegionPackage(parsed)))
    .digest("hex")
  if (geometrySha256 !== manifestEntry.geometrySha256) {
    throw new Error(`${expectedFile.file}: geometry SHA-256 does not match the manifest`)
  }
}

const committedFiles = (await readdir(outputDirectory))
  .filter((file) => file === "manifest.json" || /^region-[a-z]+\.json$/.test(file))
  .toSorted()
const expectedFiles = ["manifest.json", ...expected.files.map((file) => file.file)].toSorted()
if (JSON.stringify(committedFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error("mesh region asset directory contains missing or unexpected region packages")
}

console.log(`verified ${expected.files.length} independently addressable mesh region packages`)
