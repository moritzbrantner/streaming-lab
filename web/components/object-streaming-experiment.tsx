"use client"

import {type ChangeEvent, useMemo, useState} from "react"
import {
  objectLods,
  simulateObjectStreaming,
  type ObjectStreamingStrategy,
} from "@/lib/object-streaming"
import styles from "./object-streaming-experiment.module.css"

const strategyLabels: Record<ObjectStreamingStrategy, string> = {
  "dependent-refinements": "Dependent refinements",
  "independent-lods": "Independent LOD checkpoints",
}

const strategyExplanations: Record<ObjectStreamingStrategy, string> = {
  "dependent-refinements":
    "Each package only adds the difference from the previous LOD. This minimizes payload, but one unrecovered layer prevents later refinements from being applied.",
  "independent-lods":
    "Each package is a complete mesh checkpoint. It sends more data, but a later LOD can still become usable even when an earlier package was lost.",
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <label className="control">
      <span>
        {label}
        <output>{value.toLocaleString()} {unit}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function Metric({label, value}: {label: string; value: string}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(2)} MB`
}

function MeshPreview({level}: {level: number | null}) {
  const label = level === null ? "No complete mesh yet" : `LOD ${level} · ${objectLods[level].label}`

  return (
    <div className={styles.preview}>
      <svg viewBox="0 0 320 230" role="img" aria-label={`Mesh preview: ${label}`} className={styles.mesh}>
        {level === null ? (
          <>
            <circle cx="160" cy="108" r="54" className={styles.waitingRing} />
            <text x="160" y="113" textAnchor="middle" className={styles.waitingText}>waiting</text>
          </>
        ) : (
          <>
            <polygon points="160,26 255,78 238,174 160,208 82,174 65,78" className={styles.meshFace} />
            <polyline points="160,26 160,208 65,78 255,78 82,174 238,174 160,26" className={styles.meshLine} />
            <line x1="65" y1="78" x2="238" y2="174" className={styles.meshLine} />
            <line x1="255" y1="78" x2="82" y2="174" className={styles.meshLine} />
            {level >= 1 && (
              <>
                <polyline points="160,26 112,104 160,208 208,104 160,26" className={styles.refinementLine} />
                <line x1="65" y1="78" x2="208" y2="104" className={styles.refinementLine} />
                <line x1="255" y1="78" x2="112" y2="104" className={styles.refinementLine} />
              </>
            )}
            {level >= 2 && (
              <>
                <polyline points="112,104 82,174 160,142 238,174 208,104" className={styles.detailLine} />
                <polyline points="65,78 160,142 255,78" className={styles.detailLine} />
                <circle cx="160" cy="142" r="4" className={styles.vertex} />
              </>
            )}
            {level >= 3 && (
              <>
                <line x1="112" y1="104" x2="238" y2="174" className={styles.fullLine} />
                <line x1="208" y1="104" x2="82" y2="174" className={styles.fullLine} />
                <circle cx="112" cy="104" r="3" className={styles.vertex} />
                <circle cx="208" cy="104" r="3" className={styles.vertex} />
                <circle cx="82" cy="174" r="3" className={styles.vertex} />
                <circle cx="238" cy="174" r="3" className={styles.vertex} />
              </>
            )}
          </>
        )}
      </svg>
      <div>
        <strong>{label}</strong>
        <span>{level === null ? "0 triangles usable" : `${objectLods[level].triangles.toLocaleString()} triangles usable`}</span>
      </div>
    </div>
  )
}

export function ObjectStreamingExperiment() {
  const [bandwidthMbps, setBandwidthMbps] = useState(6)
  const [latencyMs, setLatencyMs] = useState(60)
  const [lossPercent, setLossPercent] = useState(18)
  const [retry, setRetry] = useState(false)
  const [strategy, setStrategy] = useState<ObjectStreamingStrategy>("dependent-refinements")

  const result = useMemo(
    () => simulateObjectStreaming({bandwidthMbps, latencyMs, lossPercent, retry, strategy}),
    [bandwidthMbps, latencyMs, lossPercent, retry, strategy],
  )

  return (
    <section className="experiment" id="objects-3d">
      <header className="experiment-header">
        <div className="experiment-number">06</div>
        <div>
          <h2>Progressive 3D object streaming</h2>
          <p>
            Send something renderable first, then spend later bandwidth on geometry detail. Compare compact dependent
            refinements with larger checkpoints that can recover cleanly after a missing package.
          </p>
        </div>
      </header>
      <div className="experiment-body">
        <div className="controls">
          <RangeControl label="Bandwidth" value={bandwidthMbps} min={0.5} max={20} step={0.5} unit="Mbps" onChange={setBandwidthMbps} />
          <RangeControl label="Path latency" value={latencyMs} min={0} max={300} step={10} unit="ms" onChange={setLatencyMs} />
          <RangeControl label="Packet loss" value={lossPercent} min={0} max={35} unit="%" onChange={setLossPercent} />
          <label className="toggle-control">
            <input type="checkbox" checked={retry} onChange={(event) => setRetry(event.target.checked)} />
            <span>Retry missing packets once</span>
          </label>
          <label className="control">
            <span>LOD packaging</span>
            <select
              className={styles.strategySelect}
              value={strategy}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setStrategy(event.target.value as ObjectStreamingStrategy)}
            >
              {Object.entries(strategyLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="visual-panel">
          <div className={styles.topGrid}>
            <MeshPreview level={result.bestAvailableLevel} />
            <div className={styles.stageList} aria-label="3D LOD package delivery results">
              {result.lods.map((lod) => {
                const statusClass = lod.status === "available" ? styles.available : lod.status === "lost" ? styles.lost : styles.blocked
                const statusText = lod.status === "available"
                  ? `usable at ${lod.availableAtMs?.toFixed(0)} ms`
                  : lod.status === "lost"
                    ? `${lod.remainingLostPackets} packet${lod.remainingLostPackets === 1 ? "" : "s"} missing`
                    : "received, dependency missing"

                return (
                  <div className={`${styles.stage} ${statusClass}`} key={lod.level}>
                    <div className={styles.stageHeading}>
                      <strong>LOD {lod.level} · {lod.label}</strong>
                      <span>{lod.status}</span>
                    </div>
                    <div className={styles.stageMeta}>
                      <span>{lod.triangles.toLocaleString()} tris</span>
                      <span>{Math.round(lod.payloadBytes / 1000).toLocaleString()} KB</span>
                      <span>{lod.packetCount} packets</span>
                    </div>
                    <small>
                      {statusText}
                      {lod.firstAttemptLostPackets > 0 && retry ? ` · retried ${lod.firstAttemptLostPackets}` : ""}
                    </small>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="metrics-grid">
            <Metric label="First renderable mesh" value={result.firstRenderableMs === null ? "none" : `${result.firstRenderableMs.toFixed(0)} ms`} />
            <Metric label="Best complete LOD" value={result.bestAvailableLevel === null ? "none" : `LOD ${result.bestAvailableLevel}`} />
            <Metric label="Useful payload" value={formatMegabytes(result.payloadBytes)} />
            <Metric label="Bytes put on wire" value={formatMegabytes(result.wireBytes)} />
          </div>
          <p className="explanation">
            <strong>{strategyLabels[strategy]}:</strong> {strategyExplanations[strategy]} The simulator only promotes a
            mesh when that LOD is complete, so packet loss can reduce detail or delay it but never exposes a half-applied
            geometry state.
          </p>
        </div>
      </div>
    </section>
  )
}
