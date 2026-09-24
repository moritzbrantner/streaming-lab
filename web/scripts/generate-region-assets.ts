import {mkdir, writeFile} from "node:fs/promises"
import {buildMeshRegionAssetSet} from "./mesh-region-asset-set"

const outputDirectory = new URL("../public/assets/object-regions/", import.meta.url)
const generated = await buildMeshRegionAssetSet()

await mkdir(outputDirectory, {recursive: true})
for (const file of generated.files) {
  await writeFile(new URL(file.file, outputDirectory), file.text, "utf8")
}
await writeFile(new URL("manifest.json", outputDirectory), generated.manifestText, "utf8")

console.log(`generated ${generated.files.length} deterministic mesh region packages`)
