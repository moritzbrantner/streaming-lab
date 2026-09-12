"use client"

import {useEffect, useMemo, useState} from "react"
import {
  decodeEmbeddedGltf,
  inspectMeshGeometry,
  parseObjectAssetManifest,
  type MeshGeometry,
  type ObjectAssetManifestEntry,
} from "@/lib/object-asset"
import styles from "./verified-object-stream-experiment.module.css"

type PackageStatus = "queued" | "fetching" | "verified" | "rejected"

type PackageState = {
  entry: ObjectAssetManifestEntry
  status: PackageStatus
  message: string
}

type ActiveMesh = {
  entry: ObjectAssetManifestEntry
  geometry: MeshGeometry
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
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

function buildWireframePath(geometry: MeshGeometry) {
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

function statusLabel(status: PackageStatus) {
  switch (status) {
    case "queued": return "queued"
    case "fetching": return "verifying"
    case "verified": return "verified"
    case "rejected": return "rejected"
  }
}

export function VerifiedObjectStreamExperiment() {
  const [run, setRun] = useState(0)
  const [packages, setPackages] = useState<PackageState[]>([])
  const [activeMesh, setActiveMesh] = useState<ActiveMesh | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const updatePackage = (level: number, status: PackageStatus, message: string) => {
      if (cancelled) return
      setPackages((current) => current.map((item) => item.entry.level === level ? {...item, status, message} : item))
    }

    const load = async () => {
      setPackages([])
      setActiveMesh(null)
      setStreamError(null)

      try {
        const manifestResponse = await fetch("./assets/object-streaming/manifest.json", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!manifestResponse.ok) throw new Error(`manifest request failed with ${manifestResponse.status}`)
        const manifest = parseObjectAssetManifest(await manifestResponse.text())
        if (cancelled) return

        setPackages(manifest.lods.map((entry) => ({entry, status: "queued", message: "waiting for package"})))

        for (const entry of manifest.lods) {
          updatePackage(entry.level, "fetching", "downloaded bytes are not usable yet")
          try {
            const response = await fetch(`./assets/object-streaming/${entry.file}`, {
              cache: "no-store",
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`request failed with ${response.status}`)
            const text = await response.text()
            const byteLength = new TextEncoder().encode(text).byteLength
            if (byteLength !== entry.byteLength) {
              throw new Error(`byte length mismatch: expected ${entry.byteLength}, got ${byteLength}`)
            }

            const digest = await sha256Hex(text)
            if (digest !== entry.sha256) throw new Error("SHA-256 mismatch")

            const geometry = decodeEmbeddedGltf(text)
            const summary = inspectMeshGeometry(geometry)
            if (summary.vertices !== entry.vertices || summary.triangles !== entry.triangles) {
              throw new Error("geometry metadata does not match the manifest")
            }

            updatePackage(entry.level, "verified", `${summary.vertices} vertices · ${summary.triangles} triangles`)
            if (!cancelled) setActiveMesh({entry, geometry})
          } catch (error) {
            if (controller.signal.aborted) return
            updatePackage(entry.level, "rejected", error instanceof Error ? error.message : "package verification failed")
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && !cancelled) {
          setStreamError(error instanceof Error ? error.message : "asset stream failed")
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [run])

  const wireframePath = useMemo(
    () => activeMesh === null ? "" : buildWireframePath(activeMesh.geometry),
    [activeMesh],
  )
  const verifiedCount = packages.filter((item) => item.status === "verified").length
  const rejectedCount = packages.filter((item) => item.status === "rejected").length

  return (
    <section className="experiment" id="verified-objects-3d">
      <header className="experiment-header">
        <div className="experiment-number">07</div>
        <div>
          <h2>Verified real 3D asset stream</h2>
          <p>
            Fetch independently addressable glTF packages from a static manifest. A package is promoted only after its
            byte length, SHA-256, and mesh structure match the manifest, so failed verification leaves the last complete
            LOD visible.
          </p>
        </div>
      </header>
      <div className="experiment-body">
        <div className="controls">
          <div className={styles.contract}>
            <strong>Promotion contract</strong>
            <span>1. Fetch package</span>
            <span>2. Verify bytes + SHA-256</span>
            <span>3. Parse glTF + verify geometry</span>
            <span>4. Atomically replace visible LOD</span>
          </div>
          <button className={styles.reloadButton} type="button" onClick={() => setRun((value) => value + 1)}>
            Replay asset stream
          </button>
          <p className={styles.note}>The files are ordinary static GitHub Pages assets; no application server is required.</p>
        </div>
        <div className="visual-panel">
          <div className={styles.topGrid}>
            <div className={styles.preview}>
              <svg viewBox="0 0 320 236" role="img" aria-label="Wireframe of the latest verified glTF package">
                <circle cx="160" cy="118" r="82" className={styles.guide} />
                {activeMesh === null ? (
                  <text x="160" y="123" textAnchor="middle" className={styles.waiting}>waiting for verified mesh</text>
                ) : (
                  <path d={wireframePath} className={styles.wireframe} />
                )}
              </svg>
              <strong>{activeMesh === null ? "No promoted package" : `LOD ${activeMesh.entry.level} · ${activeMesh.entry.label}`}</strong>
              <span>
                {activeMesh === null
                  ? "Unverified bytes never reach the renderer"
                  : `${activeMesh.entry.vertices} vertices · ${activeMesh.entry.triangles} triangles`}
              </span>
            </div>
            <div className={styles.packageList} aria-label="Verified 3D package states">
              {packages.map(({entry, status, message}) => (
                <div className={`${styles.package} ${styles[status]}`} key={entry.level}>
                  <div className={styles.packageHeading}>
                    <strong>LOD {entry.level} · {entry.label}</strong>
                    <span>{statusLabel(status)}</span>
                  </div>
                  <small>{entry.file} · {entry.byteLength} B · {entry.sha256.slice(0, 10)}…</small>
                  <p>{message}</p>
                </div>
              ))}
              {packages.length === 0 && streamError === null && <p className={styles.loading}>Loading manifest…</p>}
              {streamError !== null && <p className={styles.error}>{streamError}</p>}
            </div>
          </div>
          <div className="metrics-grid">
            <div className="metric"><span>Manifest packages</span><strong>{packages.length || "—"}</strong></div>
            <div className="metric"><span>Verified</span><strong>{verifiedCount}</strong></div>
            <div className="metric"><span>Rejected</span><strong>{rejectedCount}</strong></div>
            <div className="metric"><span>Active complete LOD</span><strong>{activeMesh === null ? "none" : `LOD ${activeMesh.entry.level}`}</strong></div>
          </div>
          <p className="explanation">
            This is now a real content path rather than a byte-count simulation. Each LOD is a valid glTF 2.0 package,
            independently addressable and content-bound by SHA-256. Later transport experiments can lose, reorder, cache,
            or recover these packages without weakening the renderer&apos;s complete-and-verified promotion boundary.
          </p>
        </div>
      </div>
    </section>
  )
}
