"use client"

import {useEffect, useMemo, useState} from "react"
import {decodeEmbeddedGltf, type MeshGeometry} from "@/lib/object-asset"
import {
  applyMeshRefinement,
  canonicalMeshBytes,
  parseMeshRefinementPackage,
  parseRefinementManifest,
  type MeshRefinementPackage,
} from "@/lib/mesh-refinement"
import styles from "./mesh-compression-experiment.module.css"

type CompressionRow = {
  level: number
  plainBytes: number
  compressedBytes: number
  plainDecodeMicros: number
  compressedDecodeMicros: number
}

async function sha256Hex(bytes: BufferSource) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
}

async function textSha256(text: string) {
  return sha256Hex(new TextEncoder().encode(text))
}

async function geometrySha256(geometry: MeshGeometry) {
  return sha256Hex(canonicalMeshBytes(geometry))
}

async function fetchVerifiedText(
  file: string,
  expectedBytes: number,
  expectedSha256: string,
  signal: AbortSignal,
) {
  const response = await fetch(`./assets/object-refinement/${file}`, {cache: "no-store", signal})
  if (!response.ok) throw new Error(`request failed with ${response.status}`)
  const text = await response.text()
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes !== expectedBytes) throw new Error(`byte length mismatch: expected ${expectedBytes}, got ${bytes}`)
  if (await textSha256(text) !== expectedSha256) throw new Error("package SHA-256 mismatch")
  return text
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

function benchmarkDecodeMicros(base: MeshGeometry, refinement: MeshRefinementPackage, baseGeometrySha256: string) {
  const warmups = 20
  const iterations = 250
  for (let index = 0; index < warmups; index += 1) applyMeshRefinement(base, refinement, baseGeometrySha256)
  const started = performance.now()
  for (let index = 0; index < iterations; index += 1) applyMeshRefinement(base, refinement, baseGeometrySha256)
  return ((performance.now() - started) * 1000) / iterations
}

export function MeshCompressionExperiment() {
  const [rows, setRows] = useState<CompressionRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const load = async () => {
      setRows([])
      setError(null)
      try {
        const manifestResponse = await fetch("./assets/object-refinement/manifest.json", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!manifestResponse.ok) throw new Error(`manifest request failed with ${manifestResponse.status}`)
        const manifest = parseRefinementManifest(await manifestResponse.text())
        const baseEntry = manifest.checkpoints[0]
        const baseText = await fetchVerifiedText(baseEntry.file, baseEntry.byteLength, baseEntry.sha256, controller.signal)
        const base = decodeEmbeddedGltf(baseText)
        const baseSha256 = await geometrySha256(base)
        if (baseSha256 !== baseEntry.geometrySha256) throw new Error("base checkpoint geometry fingerprint mismatch")

        let plainGeometry = base
        let compressedGeometry = base
        let plainSha256 = baseSha256
        let compressedSha256 = baseSha256
        const nextRows: CompressionRow[] = []

        for (let index = 0; index < manifest.refinements.length; index += 1) {
          const plainEntry = manifest.refinements[index]
          const compressedEntry = manifest.compressedRefinements[index]
          const [plainText, compressedText] = await Promise.all([
            fetchVerifiedText(plainEntry.file, plainEntry.byteLength, plainEntry.sha256, controller.signal),
            fetchVerifiedText(compressedEntry.file, compressedEntry.byteLength, compressedEntry.sha256, controller.signal),
          ])
          const plainRefinement = parseMeshRefinementPackage(plainText)
          const compressedRefinement = parseMeshRefinementPackage(compressedText)
          if (plainRefinement.schemaVersion !== 1 || compressedRefinement.schemaVersion !== 2) {
            throw new Error("compression experiment received the wrong package encoding")
          }

          const plainDecodeMicros = benchmarkDecodeMicros(plainGeometry, plainRefinement, plainSha256)
          const compressedDecodeMicros = benchmarkDecodeMicros(
            compressedGeometry,
            compressedRefinement,
            compressedSha256,
          )
          const nextPlainGeometry = applyMeshRefinement(plainGeometry, plainRefinement, plainSha256)
          const nextCompressedGeometry = applyMeshRefinement(compressedGeometry, compressedRefinement, compressedSha256)
          const nextPlainSha256 = await geometrySha256(nextPlainGeometry)
          const nextCompressedSha256 = await geometrySha256(nextCompressedGeometry)
          if (
            nextPlainSha256 !== plainEntry.resultGeometrySha256 ||
            nextCompressedSha256 !== compressedEntry.resultGeometrySha256 ||
            !bytesEqual(canonicalMeshBytes(nextPlainGeometry), canonicalMeshBytes(nextCompressedGeometry))
          ) {
            throw new Error(`LOD ${plainEntry.toLevel} compression changed canonical geometry`)
          }

          plainGeometry = nextPlainGeometry
          compressedGeometry = nextCompressedGeometry
          plainSha256 = nextPlainSha256
          compressedSha256 = nextCompressedSha256
          nextRows.push({
            level: plainEntry.toLevel,
            plainBytes: plainEntry.byteLength,
            compressedBytes: compressedEntry.byteLength,
            plainDecodeMicros,
            compressedDecodeMicros,
          })
        }

        if (plainSha256 !== manifest.sourceGeometrySha256 || compressedSha256 !== manifest.sourceGeometrySha256) {
          throw new Error("compressed chain did not reconstruct the source checkpoint")
        }
        if (!cancelled) setRows(nextRows)
      } catch (caught) {
        if (!controller.signal.aborted && !cancelled) {
          setError(caught instanceof Error ? caught.message : "compression experiment failed")
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const totals = useMemo(() => rows.reduce(
    (total, row) => ({
      plainBytes: total.plainBytes + row.plainBytes,
      compressedBytes: total.compressedBytes + row.compressedBytes,
    }),
    {plainBytes: 0, compressedBytes: 0},
  ), [rows])
  const totalSaving = totals.plainBytes === 0
    ? 0
    : ((totals.plainBytes - totals.compressedBytes) / totals.plainBytes) * 100

  return (
    <section className="experiment" id="mesh-compression-3d">
      <header className="experiment-header">
        <div className="experiment-number">09</div>
        <div>
          <h2>Lossless geometry compression and decode cost</h2>
          <p>
            The compressed path keeps float32 geometry exact: position bit patterns use per-axis XOR varints and triangle
            indices use signed delta varints. Package hashes and canonical geometry fingerprints still gate promotion.
          </p>
        </div>
      </header>
      <div className="experiment-body">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Destination</th>
                <th>Plain delta</th>
                <th>Compressed</th>
                <th>Bytes saved</th>
                <th>Plain decode</th>
                <th>Compressed decode</th>
                <th>Geometry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const saving = ((row.plainBytes - row.compressedBytes) / row.plainBytes) * 100
                return (
                  <tr key={row.level}>
                    <td>LOD {row.level}</td>
                    <td>{row.plainBytes} B</td>
                    <td>{row.compressedBytes} B</td>
                    <td>{saving.toFixed(1)}%</td>
                    <td>{row.plainDecodeMicros.toFixed(1)} µs</td>
                    <td>{row.compressedDecodeMicros.toFixed(1)} µs</td>
                    <td className={styles.exact}>exact</td>
                  </tr>
                )
              })}
              {rows.length > 0 && (
                <tr className={styles.total}>
                  <td>Total deltas</td>
                  <td>{totals.plainBytes} B</td>
                  <td>{totals.compressedBytes} B</td>
                  <td>{totalSaving.toFixed(1)}%</td>
                  <td colSpan={3}>Base checkpoint excluded because both paths share it.</td>
                </tr>
              )}
            </tbody>
          </table>
          {rows.length === 0 && error === null && <p className={styles.note}>Verifying exact compressed geometry…</p>}
          {error !== null && <p className={styles.error}>{error}</p>}
        </div>
        <p className="explanation">
          Decode timings are browser-local averages over 250 decodes after warmup and are observational only. Exact package
          bytes, deterministic codec regeneration, dependency fingerprints, and canonical geometry equality remain the
          correctness evidence; no timing threshold can make invalid geometry acceptable.
        </p>
      </div>
    </section>
  )
}
