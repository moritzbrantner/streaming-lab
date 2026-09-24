"use client"

import {useEffect, useMemo, useState} from "react"
import {decodeEmbeddedGltf} from "@/lib/object-asset"
import {canonicalMeshBytes, parseRefinementManifest} from "@/lib/mesh-refinement"
import {
  partitionMeshRegions,
  simulateMeshRegionStreaming,
  type MeshRegionPartition,
  type MeshRegionStreamingResult,
  type Vector3,
} from "@/lib/mesh-region-prioritization"
import styles from "./mesh-region-prioritization-experiment.module.css"

type CameraPresetId = "front" | "right" | "back" | "left" | "top" | "bottom"

type CameraPreset = {
  label: string
  position: Vector3
}

const cameraPresets: Record<CameraPresetId, CameraPreset> = {
  front: {label: "Front (+Z)", position: [0, 0, 4]},
  right: {label: "Right (+X)", position: [4, 0, 0]},
  back: {label: "Back (-Z)", position: [0, 0, -4]},
  left: {label: "Left (-X)", position: [-4, 0, 0]},
  top: {label: "Top (+Y)", position: [0, 4, 0]},
  bottom: {label: "Bottom (-Y)", position: [0, -4, 0]},
}

async function sha256Hex(bytes: BufferSource) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
}

async function textSha256(text: string) {
  return sha256Hex(new TextEncoder().encode(text))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function PreciseNumberInput({
  label,
  value,
  min,
  max,
  step,
  unit,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onCommit: (value: number) => void
}) {
  const commit = (input: HTMLInputElement) => {
    const parsed = Number(input.value)
    if (!Number.isFinite(parsed)) {
      input.value = String(value)
      return
    }
    const next = clamp(parsed, min, max)
    input.value = String(next)
    onCommit(next)
  }

  return (
    <label className={styles.numberControl}>
      <span>{label}</span>
      <span className={styles.numberEditor}>
        <input
          type="number"
          defaultValue={value}
          min={min}
          max={max}
          step={step}
          onBlur={(event) => commit(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur()
            }
            if (event.key === "Escape") {
              event.currentTarget.value = String(value)
              event.currentTarget.blur()
            }
          }}
        />
        <small>{unit}</small>
      </span>
    </label>
  )
}

function formatTime(value: number | null) {
  return value === null ? "none" : `${value.toFixed(1)} ms`
}

function formatBytes(value: number) {
  return `${value.toLocaleString()} B`
}

function resultRows(sourceOrder: MeshRegionStreamingResult, viewPriority: MeshRegionStreamingResult) {
  const prioritizedById = new Map(viewPriority.deliveries.map((delivery) => [delivery.id, delivery]))
  return sourceOrder.deliveries.map((source) => {
    const prioritized = prioritizedById.get(source.id)
    if (prioritized === undefined) {
      throw new Error(`missing prioritized region ${source.id}`)
    }
    return {source, prioritized}
  })
}

export function MeshRegionPrioritizationExperiment() {
  const [partition, setPartition] = useState<MeshRegionPartition | null>(null)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [cameraPresetId, setCameraPresetId] = useState<CameraPresetId>("front")
  const [bandwidthMbps, setBandwidthMbps] = useState(8)
  const [latencyMs, setLatencyMs] = useState(40)
  const [budgetMs, setBudgetMs] = useState(100)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const load = async () => {
      setAssetError(null)
      try {
        const manifestResponse = await fetch("./assets/object-refinement/manifest.json", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!manifestResponse.ok) {
          throw new Error(`manifest request failed with ${manifestResponse.status}`)
        }
        const manifest = parseRefinementManifest(await manifestResponse.text())
        const detailEntry = manifest.checkpoints.at(-1)
        if (detailEntry === undefined) {
          throw new Error("refinement manifest has no detail checkpoint")
        }

        const detailResponse = await fetch(`./assets/object-refinement/${detailEntry.file}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!detailResponse.ok) {
          throw new Error(`detail request failed with ${detailResponse.status}`)
        }
        const text = await detailResponse.text()
        const byteLength = new TextEncoder().encode(text).byteLength
        if (byteLength !== detailEntry.byteLength) {
          throw new Error(`detail byte length mismatch: expected ${detailEntry.byteLength}, got ${byteLength}`)
        }
        if (await textSha256(text) !== detailEntry.sha256) {
          throw new Error("detail package SHA-256 mismatch")
        }

        const geometry = decodeEmbeddedGltf(text)
        if (await sha256Hex(canonicalMeshBytes(geometry)) !== detailEntry.geometrySha256) {
          throw new Error("detail geometry fingerprint mismatch")
        }
        if (!cancelled) {
          setPartition(partitionMeshRegions(geometry))
        }
      } catch (caught) {
        if (!controller.signal.aborted && !cancelled) {
          setAssetError(caught instanceof Error ? caught.message : "mesh region experiment failed")
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const camera = cameraPresets[cameraPresetId]
  const comparison = useMemo(() => {
    if (partition === null) {
      return null
    }
    const common = {
      partition,
      cameraPosition: camera.position,
      bandwidthMbps,
      latencyMs,
      budgetMs,
    }
    const sourceOrder = simulateMeshRegionStreaming({...common, strategy: "source-order"})
    const viewPriority = simulateMeshRegionStreaming({...common, strategy: "view-priority"})
    return {sourceOrder, viewPriority, rows: resultRows(sourceOrder, viewPriority)}
  }, [partition, camera, bandwidthMbps, latencyMs, budgetMs])

  const duplicatedPercent = partition === null || partition.monolithicPayloadBytes === 0
    ? 0
    : (partition.regionPayloadBytes - partition.monolithicPayloadBytes) / partition.monolithicPayloadBytes * 100

  return (
    <section className="experiment" id="mesh-regions-3d">
      <header className="experiment-header">
        <div className="experiment-number">10</div>
        <div>
          <h2>View-prioritized mesh regions</h2>
          <p>
            Partition the verified detail mesh by dominant surface direction, then compare source-order delivery with a
            scheduler that sends view-facing regions first and the remaining regions from nearest to farthest.
          </p>
        </div>
      </header>
      <div className="experiment-body">
        <div className="controls">
          <label className={styles.selectControl}>
            <span>Camera position</span>
            <select
              value={cameraPresetId}
              onChange={(event) => setCameraPresetId(event.target.value as CameraPresetId)}
            >
              {Object.entries(cameraPresets).map(([id, preset]) => (
                <option value={id} key={id}>{preset.label}</option>
              ))}
            </select>
          </label>
          <PreciseNumberInput
            label="Bandwidth"
            value={bandwidthMbps}
            min={0.1}
            max={100}
            step={0.1}
            unit="Mbps"
            onCommit={setBandwidthMbps}
          />
          <PreciseNumberInput
            label="Per-region latency"
            value={latencyMs}
            min={0}
            max={500}
            step={1}
            unit="ms"
            onCommit={setLatencyMs}
          />
          <PreciseNumberInput
            label="Observation budget"
            value={budgetMs}
            min={0}
            max={5000}
            step={1}
            unit="ms"
            onCommit={setBudgetMs}
          />
          {partition !== null && (
            <p className={styles.payloadNote}>
              Independent raw regions use {formatBytes(partition.regionPayloadBytes)} versus {formatBytes(partition.monolithicPayloadBytes)}
              for one monolithic raw mesh ({duplicatedPercent.toFixed(1)}% extra from shared vertices appearing in more than one region).
            </p>
          )}
        </div>
        <div className="visual-panel">
          {comparison === null && assetError === null && (
            <p className={styles.status} aria-live="polite">Loading and verifying the detail mesh…</p>
          )}
          {assetError !== null && <p className={styles.error} role="alert">{assetError}</p>}
          {comparison !== null && (
            <>
              <div className={styles.orderGrid}>
                <div>
                  <h3>Source order</h3>
                  <ol className={styles.orderList}>
                    {comparison.sourceOrder.deliveries.map((delivery) => (
                      <li className={delivery.viewFacing ? styles.viewFacing : undefined} key={delivery.id}>
                        <strong>{delivery.id}</strong>
                        <span>{delivery.triangleCount} tris · {delivery.completedAtMs.toFixed(1)} ms</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h3>View priority</h3>
                  <ol className={styles.orderList}>
                    {comparison.viewPriority.deliveries.map((delivery) => (
                      <li className={delivery.viewFacing ? styles.viewFacing : undefined} key={delivery.id}>
                        <strong>{delivery.id}</strong>
                        <span>{delivery.triangleCount} tris · {delivery.completedAtMs.toFixed(1)} ms</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <div className={styles.summaryWrap}>
                <table className={styles.summaryTable}>
                  <thead>
                    <tr>
                      <th>Outcome</th>
                      <th>Source order</th>
                      <th>View priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>First view-facing detail</td>
                      <td>{formatTime(comparison.sourceOrder.firstVisibleMs)}</td>
                      <td>{formatTime(comparison.viewPriority.firstVisibleMs)}</td>
                    </tr>
                    <tr>
                      <td>View-facing triangles by {budgetMs.toFixed(0)} ms</td>
                      <td>{comparison.sourceOrder.visibleTrianglesWithinBudget} / {comparison.sourceOrder.visibleTriangles}</td>
                      <td>{comparison.viewPriority.visibleTrianglesWithinBudget} / {comparison.viewPriority.visibleTriangles}</td>
                    </tr>
                    <tr>
                      <td>Whole regional mesh complete</td>
                      <td>{formatTime(comparison.sourceOrder.completeMs)}</td>
                      <td>{formatTime(comparison.viewPriority.completeMs)}</td>
                    </tr>
                    <tr>
                      <td>Total regional payload</td>
                      <td>{formatBytes(comparison.sourceOrder.payloadBytes)}</td>
                      <td>{formatBytes(comparison.viewPriority.payloadBytes)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className={styles.regionTableWrap}>
                <table className={styles.regionTable}>
                  <thead>
                    <tr>
                      <th>Region</th>
                      <th>Facing camera</th>
                      <th>Triangles</th>
                      <th>Raw payload</th>
                      <th>Source rank</th>
                      <th>Priority rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map(({source, prioritized}) => (
                      <tr className={source.viewFacing ? styles.viewFacingRow : undefined} key={source.id}>
                        <td>{source.id}</td>
                        <td>{source.viewFacing ? "yes" : "no"}</td>
                        <td>{source.triangleCount}</td>
                        <td>{formatBytes(source.payloadBytes)}</td>
                        <td>{source.order}</td>
                        <td>{prioritized.order}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="explanation">
                Region packages are a deterministic scheduling model derived from the real verified detail mesh, not yet
                separately materialized files. The comparison therefore proves ordering semantics and byte/triangle
                accounting without claiming transport or renderer support that has not been implemented. Both schedules
                send the same regions and finish at the same time; only useful detail arrival changes.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
