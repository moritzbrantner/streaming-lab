"use client"

import {type ChangeEvent, useEffect, useMemo, useState} from "react"
import {decodeEmbeddedGltf, type MeshGeometry} from "@/lib/object-asset"
import {
  applyMeshRefinement,
  canonicalMeshBytes,
  parseMeshRefinementPackage,
  parseRefinementManifest,
  type RefinementManifest,
} from "@/lib/mesh-refinement"
import styles from "./mesh-refinement-experiment.module.css"

type PackagingStrategy = "checkpoints" | "refinements"
type StageStatus = "queued" | "fetching" | "verified" | "lost" | "blocked" | "rejected"

type StageState = {
  level: number
  label: string
  file: string
  byteLength: number
  status: StageStatus
  message: string
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

function project([x, y, z]: [number, number, number]): [number, number] {
  const yaw = 0.72
  const pitch = -0.42
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)
  const rotatedX = x * cosYaw - z * sinYaw
  const yawZ = x * sinYaw + z * cosYaw
  const rotatedY = y * cosPitch - yawZ * sinPitch
  const rotatedZ = y * sinPitch + yawZ * cosPitch
  const scale = 150 / (rotatedZ + 3.4)
  return [160 + rotatedX * scale, 118 - rotatedY * scale]
}

function wireframePath(geometry: MeshGeometry) {
  const projected = geometry.positions.map(project)
  const commands: string[] = []
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const a = projected[geometry.indices[index]]
    const b = projected[geometry.indices[index + 1]]
    const c = projected[geometry.indices[index + 2]]
    commands.push(`M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}L${c[0].toFixed(1)},${c[1].toFixed(1)}Z`)
  }
  return commands.join("")
}

function statusLabel(status: StageStatus) {
  if (status === "fetching") return "verifying"
  return status
}

export function MeshRefinementExperiment() {
  const [strategy, setStrategy] = useState<PackagingStrategy>("refinements")
  const [lostLevel, setLostLevel] = useState("none")
  const [run, setRun] = useState(0)
  const [manifest, setManifest] = useState<RefinementManifest | null>(null)
  const [stages, setStages] = useState<StageState[]>([])
  const [active, setActive] = useState<{level: number; geometry: MeshGeometry} | null>(null)
  const [wireBytes, setWireBytes] = useState(0)
  const [streamError, setStreamError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const updateStage = (level: number, status: StageStatus, message: string) => {
      if (cancelled) return
      setStages((current) => current.map((stage) => stage.level === level ? {...stage, status, message} : stage))
    }

    const load = async () => {
      setStages([])
      setActive(null)
      setWireBytes(0)
      setStreamError(null)

      try {
        const manifestResponse = await fetch("./assets/object-refinement/manifest.json", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!manifestResponse.ok) throw new Error(`manifest request failed with ${manifestResponse.status}`)
        const nextManifest = parseRefinementManifest(await manifestResponse.text())
        if (cancelled) return
        setManifest(nextManifest)

        const nextStages: StageState[] = nextManifest.checkpoints.map((checkpoint, level) => {
          const refinement = level === 0 ? null : nextManifest.refinements[level - 1]
          const entry = strategy === "checkpoints" || refinement === null ? checkpoint : refinement
          return {
            level,
            label: checkpoint.label,
            file: entry.file,
            byteLength: entry.byteLength,
            status: "queued",
            message: level === 0 ? "base checkpoint required by both strategies" : "waiting for package",
          }
        })
        setStages(nextStages)

        const baseEntry = nextManifest.checkpoints[0]
        updateStage(0, "fetching", "verifying base checkpoint")
        const baseText = await fetchVerifiedText(baseEntry.file, baseEntry.byteLength, baseEntry.sha256, controller.signal)
        let totalWireBytes = baseEntry.byteLength
        let currentGeometry = decodeEmbeddedGltf(baseText)
        let currentGeometrySha256 = await geometrySha256(currentGeometry)
        let currentLevel = 0
        if (currentGeometrySha256 !== baseEntry.geometrySha256) throw new Error("base checkpoint geometry fingerprint mismatch")
        if (!cancelled) {
          setActive({level: 0, geometry: currentGeometry})
          setWireBytes(totalWireBytes)
        }
        updateStage(0, "verified", `${currentGeometry.positions.length} vertices · ${currentGeometry.indices.length / 3} triangles`)

        for (let level = 1; level < nextManifest.checkpoints.length; level += 1) {
          const missing = lostLevel === String(level)
          const checkpoint = nextManifest.checkpoints[level]
          const refinementEntry = nextManifest.refinements[level - 1]
          const entry = strategy === "checkpoints" ? checkpoint : refinementEntry

          totalWireBytes += entry.byteLength
          if (!cancelled) setWireBytes(totalWireBytes)
          if (missing) {
            updateStage(level, "lost", `${entry.file} was sent but did not arrive`)
            continue
          }

          updateStage(level, "fetching", "downloaded bytes are not usable yet")
          try {
            const text = await fetchVerifiedText(entry.file, entry.byteLength, entry.sha256, controller.signal)

            if (strategy === "checkpoints") {
              const geometry = decodeEmbeddedGltf(text)
              const fingerprint = await geometrySha256(geometry)
              if (fingerprint !== checkpoint.geometrySha256) throw new Error("checkpoint geometry fingerprint mismatch")
              currentGeometry = geometry
              currentGeometrySha256 = fingerprint
              currentLevel = level
              updateStage(level, "verified", "complete checkpoint promoted independently")
              if (!cancelled) setActive({level, geometry})
              continue
            }

            const refinement = parseMeshRefinementPackage(text)
            if (
              refinement.fromLevel !== refinementEntry.fromLevel ||
              refinement.toLevel !== refinementEntry.toLevel ||
              refinement.baseGeometrySha256 !== refinementEntry.baseGeometrySha256 ||
              refinement.resultGeometrySha256 !== refinementEntry.resultGeometrySha256
            ) {
              throw new Error("refinement metadata does not match the manifest")
            }
            if (currentLevel !== refinement.fromLevel) {
              updateStage(level, "blocked", `needs LOD ${refinement.fromLevel}; current complete state is LOD ${currentLevel}`)
              continue
            }

            const candidate = applyMeshRefinement(currentGeometry, refinement, currentGeometrySha256)
            const candidateSha256 = await geometrySha256(candidate)
            if (candidateSha256 !== refinement.resultGeometrySha256) {
              throw new Error("refinement result fingerprint mismatch")
            }

            currentGeometry = candidate
            currentGeometrySha256 = candidateSha256
            currentLevel = level
            updateStage(level, "verified", "delta verified and atomically applied")
            if (!cancelled) setActive({level, geometry: candidate})
          } catch (error) {
            if (controller.signal.aborted) return
            updateStage(level, "rejected", error instanceof Error ? error.message : "package verification failed")
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && !cancelled) {
          setStreamError(error instanceof Error ? error.message : "refinement stream failed")
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [strategy, lostLevel, run])

  const path = useMemo(() => active === null ? "" : wireframePath(active.geometry), [active])
  const checkpointBytes = manifest?.checkpoints.reduce((sum, entry) => sum + entry.byteLength, 0) ?? 0
  const refinementBytes = manifest === null
    ? 0
    : manifest.checkpoints[0].byteLength + manifest.refinements.reduce((sum, entry) => sum + entry.byteLength, 0)
  const savingsPercent = checkpointBytes === 0 ? 0 : ((checkpointBytes - refinementBytes) / checkpointBytes) * 100

  return (
    <section className="experiment" id="mesh-refinements-3d">
      <header className="experiment-header">
        <div className="experiment-number">08</div>
        <div>
          <h2>Full checkpoints versus mesh refinements</h2>
          <p>
            Both paths reconstruct the same deterministic source hierarchy. Full checkpoints resend complete meshes;
            refinement packages append only new vertices and replace topology, which saves bytes but introduces a strict
            dependency on the previous verified geometry state.
          </p>
        </div>
      </header>
      <div className="experiment-body">
        <div className="controls">
          <label className="control">
            <span>Packaging strategy</span>
            <select className={styles.select} value={strategy} onChange={(event: ChangeEvent<HTMLSelectElement>) => setStrategy(event.target.value as PackagingStrategy)}>
              <option value="checkpoints">Independent checkpoints</option>
              <option value="refinements">Dependent refinements</option>
            </select>
          </label>
          <label className="control">
            <span>Simulated missing package</span>
            <select className={styles.select} value={lostLevel} onChange={(event: ChangeEvent<HTMLSelectElement>) => setLostLevel(event.target.value)}>
              <option value="none">None</option>
              <option value="1">LOD 1 package</option>
              <option value="2">LOD 2 package</option>
            </select>
          </label>
          <button className={styles.replayButton} type="button" onClick={() => setRun((value) => value + 1)}>Replay stream</button>
          <div className={styles.comparison}>
            <strong>Lossless payload</strong>
            <span>Checkpoints <b>{checkpointBytes || "—"} B</b></span>
            <span>Refinements <b>{refinementBytes || "—"} B</b></span>
            <span>Delta saving <b>{manifest === null ? "—" : `${savingsPercent.toFixed(1)}%`}</b></span>
          </div>
        </div>
        <div className="visual-panel">
          <div className={styles.topGrid}>
            <div className={styles.preview}>
              <svg viewBox="0 0 320 236" role="img" aria-label="Latest complete mesh reconstructed by the selected package strategy">
                <circle cx="160" cy="118" r="82" className={styles.guide} />
                {active === null
                  ? <text x="160" y="123" textAnchor="middle" className={styles.waiting}>waiting for base mesh</text>
                  : <path d={path} className={styles.wireframe} />}
              </svg>
              <strong>{active === null ? "No verified mesh" : `LOD ${active.level}`}</strong>
              <span>{active === null ? "Nothing unverified reaches the renderer" : `${active.geometry.positions.length} vertices · ${active.geometry.indices.length / 3} triangles`}</span>
            </div>
            <div className={styles.stageList} aria-label="Checkpoint or refinement delivery states">
              {stages.map((stage) => (
                <div className={`${styles.stage} ${styles[stage.status]}`} key={stage.level}>
                  <div className={styles.stageHeading}>
                    <strong>LOD {stage.level} · {stage.label}</strong>
                    <span>{statusLabel(stage.status)}</span>
                  </div>
                  <small>{stage.file} · {stage.byteLength} B</small>
                  <p>{stage.message}</p>
                </div>
              ))}
              {stages.length === 0 && streamError === null && <p className={styles.note}>Loading refinement manifest…</p>}
              {streamError !== null && <p className={styles.error}>{streamError}</p>}
            </div>
          </div>
          <div className="metrics-grid">
            <div className="metric"><span>Bytes put on wire</span><strong>{wireBytes || "—"}</strong></div>
            <div className="metric"><span>Best complete LOD</span><strong>{active === null ? "none" : `LOD ${active.level}`}</strong></div>
            <div className="metric"><span>Current vertices</span><strong>{active?.geometry.positions.length ?? 0}</strong></div>
            <div className="metric"><span>Current triangles</span><strong>{active === null ? 0 : active.geometry.indices.length / 3}</strong></div>
          </div>
          <p className="explanation">
            Lose LOD 1 and the difference becomes visible: the independent LOD 2 checkpoint still recovers to full detail,
            while refinement 1→2 arrives but cannot be applied because its declared base geometry fingerprint is absent.
            No partial mutation is exposed; the renderer keeps the last complete verified mesh.
          </p>
        </div>
      </div>
    </section>
  )
}
