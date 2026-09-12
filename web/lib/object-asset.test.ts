import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, expect, test} from "bun:test"
import {decodeEmbeddedGltf, inspectMeshGeometry, parseObjectAssetManifest} from "./object-asset"

const assetDirectory = new URL("../public/assets/object-streaming/", import.meta.url)

describe("verified object asset packages", () => {
  test("the committed manifest binds every real glTF package", async () => {
    const manifest = parseObjectAssetManifest(await readFile(new URL("manifest.json", assetDirectory), "utf8"))

    for (const entry of manifest.lods) {
      const text = await readFile(new URL(entry.file, assetDirectory), "utf8")
      expect(Buffer.byteLength(text)).toBe(entry.byteLength)
      expect(createHash("sha256").update(text).digest("hex")).toBe(entry.sha256)
      expect(inspectMeshGeometry(decodeEmbeddedGltf(text))).toEqual({
        vertices: entry.vertices,
        triangles: entry.triangles,
      })
    }
  })

  test("manifest LODs must be contiguous", () => {
    expect(() => parseObjectAssetManifest(JSON.stringify({
      schemaVersion: 1,
      asset: "bad",
      lods: [{
        level: 1,
        label: "wrong",
        file: "wrong.gltf",
        byteLength: 1,
        vertices: 1,
        triangles: 1,
        sha256: "0".repeat(64),
      }],
    }))).toThrow()
  })

  test("manifest detail must strictly increase", () => {
    const entry = (level: number, triangles: number) => ({
      level,
      label: `LOD ${level}`,
      file: `lod-${level}.gltf`,
      byteLength: 1,
      vertices: level + 1,
      triangles,
      sha256: "0".repeat(64),
    })

    expect(() => parseObjectAssetManifest(JSON.stringify({
      schemaVersion: 1,
      asset: "bad",
      lods: [entry(0, 4), entry(1, 4)],
    }))).toThrow("triangle counts must strictly increase")
  })
})
