"use client"

import {useEffect, useMemo, useState} from "react"
import {canonicalMeshBytes} from "@/lib/mesh-refinement"
import {
  decodeMeshRegionPackage,
  parseMeshRegionManifest,
  parseMeshRegionPackage,
  partitionMeshRegionManifest,
  serializeMeshRegionProvenance,
  simulateMeshRegionStreaming,
  type MeshRegionId,
  type MeshRegionManifest,
  type MeshRegionStreamingResult,
  type Vector3,
} from "@/lib/mesh-region-prioritization"
import {PreciseRangeControl} from "./precise-range-control"
import styles from "./mesh-region-prioritization-experiment.module.css"

type CameraPresetId = "front" | "right" | "back" | "left" | "top" | "bottom"
type PackageStatus = "queued" | "fetching" | "verified" | "rejected"

type CameraPreset = {
  label: string
  position: Vector3
}

type PackageState = {
  status: PackageStatus
  message: string
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

function statusLabel(status: PackageStatus | undefined) {
  return status ?? "queued"
}

export function MeshRegionPrioritizationExperiment() {
  const [manifest, setManifest] = useState<MeshRegionManifest | null>(null)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [packageStates, setPackageStates] = useState<Partial<Record<MeshRegionId, PackageState>>>({})
  const [verificationRun, setVerificationRun] = useState(0)
  const [cameraPresetId, setCameraPresetId] = useState<CameraPresetId>("front")
  const [bandwidthMbps, setBandwidthMbps] = useState(8)
  const [latencyMs, setLatencyMs] = useState(40)
  const [budgetMs, setBudgetMs] = useState(100)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const loadManifest = async () => {
      setAssetError(null)
      try {
        const response = await fetch("./assets/object-regions/manifest.json", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`region manifest request failed with ${response.status}`)
        }
        const nextManifest = parseMeshRegionManifest(await response.text())
        if (!cancelled) {
          setManifest(nextManifest)
        }
      } catch (caught) {
        if (!controller.signal.aborted && !cancelled) {
          setAssetError(caught instanceof Error ? caught.message : "mesh region manifest failed")
        }
      }
    }

    void loadManifest()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const camera = cameraPresets[cameraPresetId]
  const partition = useMemo(
    () => manifest === null ? null : partitionMeshRegionManifest(manifest),
    [manifest],
  )
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

  const verificationOrder = useMemo(() => {
    if (partition === null) {
      return []
    }
    return simulateMeshRegionStreaming({
      partition,
      cameraPosition: camera.position,
      bandwidthMbps: 1,
      latencyMs: 0,
      budgetMs: 0,
      strategy: "view-priority",
    }).deliveries.map((delivery) => delivery.id)
  }, [partition, camera])

  useEffect(() => {
    if (manifest === null || verificationOrder.length === 0) {
      return
    }

    const controller = new AbortController()
    let cancelled = false
    const initialStates: Partial<Record<MeshRegionId, PackageState>> = {}
    for (const entry of manifest.regions) {
      initialStates[entry.id] = {status: "queued", message: "waiting for verification"}
    }
    setPackageStates(initialStates)

    const updatePackage = (id: MeshRegionId, state: PackageState) => {
      if (!cancelled) {
        setPackageStates((current) => ({...current, [id]: state}))
      }
    }

    const verifyPackages = async () => {
      for (const id of verificationOrder) {
        const entry = manifest.regions.find((region) => region.id === id)
        if (entry === undefined) {
          updatePackage(id, {status: "rejected", message: "region is missing from manifest"})
          continue
        }

        updatePackage(id, {status: "fetching", message: "downloaded bytes are not usable yet"})
        try {
          const response = await fetch(`./assets/object-regions/${entry.file}`, {
            cache: "no-store",
            signal: controller.signal,
          })
          if (!response.ok) {
            throw new Error(`request failed with ${response.status}`)
          }
          const text = await response.text()
          const byteLength = new TextEncoder().encode(text).byteLength
          if (byteLength !== entry.byteLength) {
            throw new Error(`byte length mismatch: expected ${entry.byteLength}, got ${byteLength}`)
          }
          if (await textSha256(text) !== entry.sha256) {
            throw new Error("package SHA-256 mismatch")
          }

          const regionPackage = parseMeshRegionPackage(text)
          if (
            regionPackage.region !== entry.id ||
            regionPackage.sourceGeometrySha256 !== manifest.sourceGeometrySha256 ||
            regionPackage.firstTriangle !== entry.firstTriangle ||
            regionPackage.sourceTriangleIndexes.length !== entry.triangleCount ||
            regionPackage.sourceVertexIndexes.length !== entry.vertexCount
          ) {
            throw new Error("package provenance does not match the manifest")
          }

          if (await textSha256(serializeMeshRegionProvenance(regionPackage)) !== entry.provenanceSha256) {
            throw new Error("package source provenance fingerprint mismatch")
          }

          const geometry = decodeMeshRegionPackage(regionPackage)
          if (await sha256Hex(canonicalMeshBytes(geometry)) !== entry.geometrySha256) {
            throw new Error("region geometry fingerprint mismatch")
          }

          updatePackage(id, {
            status: "verified",
            message: `${entry.triangleCount} triangles promoted after byte, hash, provenance, and geometry checks`,
          })
        } catch (caught) {
          if (controller.signal.aborted) {
            return
          }
          updatePackage(id, {
            status: "rejected",
            message: caught instanceof Error ? caught.message : "package verification failed",
          })
        }
      }
    }

    void verifyPackages()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [manifest, verificationOrder, verificationRun])

  const rawDuplicationPercent = partition === null || partition.monolithicGeometryBytes === 0
    ? 0
    : (partition.regionGeometryBytes - partition.monolithicGeometryBytes) / partition.monolithicGeometryBytes * 100
  const packageOverheadPercent = partition === null || partition.monolithicPackageBytes === 0
    ? 0
    : (partition.regionPackageBytes - partition.monolithicPackageBytes) / partition.monolithicPackageBytes * 100
  const verifiedTriangles = manifest?.regions.reduce(
    (total, entry) => total + (packageStates[entry.id]?.status === "verified" ? entry.triangleCount : 0),
    0,
  ) ?? 0

  return (
    <section className="experiment" id="mesh-regions-3d">
      <header className="experiment-header">
        <div className="experiment-number">10</div>
        <div>
          <h2>Verified, view-prioritized mesh regions</h2>
          <p>
            Fetch six independently addressable packages from the verified detail mesh. View priority changes delivery
            order, while each region becomes usable only after its bytes, SHA-256, source provenance, and local geometry
            fingerprint match the manifest.
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
          <PreciseRangeControl
            label="Bandwidth"
            value={bandwidthMbps}
            min={0.1}
            max={100}
            step={0.1}
            unit="Mbps"
            onChange={setBandwidthMbps}
          />
          <PreciseRangeControl
            label="Per-region latency"
            value={latencyMs}
            min={0}
            max={500}
            step={1}
            unit="ms"
            onChange={setLatencyMs}
          />
          <PreciseRangeControl
            label="Observation budget"
            value={budgetMs}
            min={0}
            max={5000}
            step={1}
            unit="ms"
            onChange={setBudgetMs}
          />
          <button
            className={styles.replayButton}
            type="button"
            disabled={manifest === null}
            onClick={() => setVerificationRun((value) => value + 1)}
          >
            Replay package verification
          </button>
          {partition !== null && (
            <div className={styles.payloadNote}>
              <p>
                Raw regional geometry: {formatBytes(partition.regionGeometryBytes)} vs. {formatBytes(partition.monolithicGeometryBytes)}
                {" "}({rawDuplicationPercent.toFixed(1)}% extra from shared vertices).
              </p>
              <p>
                Actual independent packages: {formatBytes(partition.regionPackageBytes)} vs. {formatBytes(partition.monolithicPackageBytes)}
                {" "}({packageOverheadPercent.toFixed(1)}% package/provenance overhead).
              </p>
            </div>
          )}
        </div>
        <div className="visual-panel">
          {comparison === null && assetError === null && (
            <p className={styles.status} aria-live="polite">Loading verified region manifest…</p>
          )}
          {assetError !== null && <p className={styles.error} role="alert">{assetError}</p>}
          {comparison !== null && manifest !== null && (
            <>
              <div className={styles.orderGrid}>
                <div>
                  <h3>Source order</h3>
                  <ol className={styles.orderList}>
                    {comparison.sourceOrder.deliveries.map((delivery) => (
                      <li className={delivery.viewFacing ? styles.viewFacing : undefined} key={delivery.id}>
                        <strong>{delivery.id}</strong>
                        <span>{delivery.packageBytes} B · {delivery.completedAtMs.toFixed(1)} ms</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h3>View priority + verification</h3>
                  <ol className={styles.orderList}>
                    {comparison.viewPriority.deliveries.map((delivery) => (
                      <li className={delivery.viewFacing ? styles.viewFacing : undefined} key={delivery.id}>
                        <strong>{delivery.id}</strong>
                        <span>
                          {delivery.packageBytes} B · {delivery.completedAtMs.toFixed(1)} ms · {statusLabel(packageStates[delivery.id]?.status)}
                        </span>
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
                      <td>First view-facing package</td>
                      <td>{formatTime(comparison.sourceOrder.firstVisibleMs)}</td>
                      <td>{formatTime(comparison.viewPriority.firstVisibleMs)}</td>
                    </tr>
                    <tr>
                      <td>View-facing triangles by {budgetMs.toFixed(0)} ms</td>
                      <td>{comparison.sourceOrder.visibleTrianglesWithinBudget} / {comparison.sourceOrder.visibleTriangles}</td>
                      <td>{comparison.viewPriority.visibleTrianglesWithinBudget} / {comparison.viewPriority.visibleTriangles}</td>
                    </tr>
                    <tr>
                      <td>All region packages modeled complete</td>
                      <td>{formatTime(comparison.sourceOrder.completeMs)}</td>
                      <td>{formatTime(comparison.viewPriority.completeMs)}</td>
                    </tr>
                    <tr>
                      <td>Total independent package bytes</td>
                      <td>{formatBytes(comparison.sourceOrder.payloadBytes)}</td>
                      <td>{formatBytes(comparison.viewPriority.payloadBytes)}</td>
                    </tr>
                    <tr>
                      <td>Actually verified/promoted triangles</td>
                      <td colSpan={2}>{verifiedTriangles} / {manifest.sourceTriangles}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className={styles.regionTableWrap}>
                <table className={styles.regionTable}>
                  <thead>
                    <tr>
                      <th>Region</th>
                      <th>Package</th>
                      <th>Raw geometry</th>
                      <th>Verification</th>
                      <th>Facing camera</th>
                      <th>Source rank</th>
                      <th>Priority rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map(({source, prioritized}) => {
                      const entry = manifest.regions.find((region) => region.id === source.id)
                      const state = packageStates[source.id]
                      return (
                        <tr className={source.viewFacing ? styles.viewFacingRow : undefined} key={source.id}>
                          <td>{source.id}</td>
                          <td>{entry === undefined ? "missing" : formatBytes(entry.byteLength)}</td>
                          <td>{formatBytes(source.geometryBytes)}</td>
                          <td
                            className={`${styles.verificationCell} ${
                              state?.status === "verified"
                                ? styles.verified
                                : state?.status === "rejected"
                                  ? styles.rejected
                                  : ""
                            }`}
                          >
                            <span>{statusLabel(state?.status)}</span>
                            {state?.status === "rejected" && (
                              <small className={styles.verificationMessage} role="alert">{state.message}</small>
                            )}
                          </td>
                          <td>{source.viewFacing ? "yes" : "no"}</td>
                          <td>{source.order}</td>
                          <td>{prioritized.order}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="explanation">
                The timing table is still a deterministic network model, but its payload sizes now come from the real
                committed region files. Package verification above is real browser work against those same files. Failed
                regions are rejected independently; later packages can still verify because no region depends on another
                region&apos;s geometry.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
