"use client"

import {type ChangeEvent, useMemo, useState} from "react"
import {
  chunkLodScenarioRoutes,
  simulateChunkLodPromotion,
  type ChunkLodPromotionResult,
  type ChunkLodPromotionStrategy,
} from "@/lib/chunk-lod-promotion"
import styles from "./chunk-lod-promotion-experiment.module.css"

type ScenarioId = keyof typeof chunkLodScenarioRoutes

const scenarioLabels: Record<ScenarioId, string> = {
  stationary: "Stationary cold start",
  steady: "Steady square traversal",
  reversal: "Rapid direction changes",
}

const strategies: Array<{strategy: ChunkLodPromotionStrategy; label: string}> = [
  {strategy: "direct", label: "Direct target"},
  {strategy: "dependent-refinements", label: "Dependent refinement"},
  {strategy: "independent-checkpoints", label: "Independent checkpoints"},
]

function formatMs(value: number | null, misses: number) {
  const formatted = value === null ? "—" : `${value.toFixed(1)} ms`
  return misses === 0 ? formatted : `${formatted} · ${misses} missed`
}

function formatBytes(value: number) {
  return value < 1024 * 1024
    ? `${(value / 1024).toFixed(0)} KiB`
    : `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function ResultRow({
  label,
  result,
}: {
  label: string
  result: ChunkLodPromotionResult
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{formatMs(result.averageFirstRenderableMs, result.missedFirstRenderableWindows)}</td>
      <td>{formatMs(result.averageNearFieldCompleteMs, result.missedNearFieldWindows)}</td>
      <td>{result.generatedWorkMs.toFixed(0)} ms</td>
      <td>{(result.discardedWorkMs + result.cancelledQueuedWorkMs).toFixed(0)} ms</td>
      <td>{formatBytes(result.peakRetainedBytes)}</td>
      <td>{result.peakRetainedEntries}</td>
    </tr>
  )
}

export function ChunkLodPromotionExperiment() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("steady")
  const [movementIntervalMs, setMovementIntervalMs] = useState(70)

  const comparisons = useMemo(() => {
    const route = chunkLodScenarioRoutes[scenarioId]
    const warmStart = scenarioId !== "stationary"
    return strategies.map(({strategy, label}) => ({
      strategy,
      label,
      result: simulateChunkLodPromotion({
        strategy,
        route,
        movementIntervalMs,
        warmStart,
      }),
    }))
  }, [scenarioId, movementIntervalMs])

  const maxWork = Math.max(...comparisons.map(({result}) => result.generatedWorkMs), 1)
  const maxMemory = Math.max(...comparisons.map(({result}) => result.peakRetainedBytes), 1)

  return (
    <section className="experiment" id="chunk-lod-promotion">
      <header className="experiment-header">
        <div className="experiment-number">12</div>
        <div>
          <h2>Progressive chunk LOD promotion</h2>
          <p>
            Compare generating only the requested WorldGen LOD with coarse-first dependent refinements and reusable
            independent checkpoints under the same movement workload.
          </p>
        </div>
      </header>
      <div className="experiment-body">
        <div className="controls">
          <label className={styles.control}>
            <span>Traversal</span>
            <select
              value={scenarioId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setScenarioId(event.target.value as ScenarioId)
              }
            >
              {Object.entries(scenarioLabels).map(([id, label]) => (
                <option value={id} key={id}>{label}</option>
              ))}
            </select>
          </label>
          <label className={styles.control}>
            <span>
              Chunk-boundary interval
              <output>{movementIntervalMs} ms</output>
            </span>
            <input
              type="number"
              min={5}
              max={500}
              step={5}
              value={movementIntervalMs}
              disabled={scenarioId === "stationary"}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next) && next >= 5 && next <= 500) {
                  setMovementIntervalMs(next)
                }
              }}
            />
          </label>
          <p className={styles.note}>
            Dependent refinement reuses prior stage work. Independent checkpoints remain individually reusable but keep
            additional generated snapshots resident.
          </p>
        </div>

        <div className="visual-panel">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>LOD strategy</th>
                  <th>First renderable</th>
                  <th>Near field complete</th>
                  <th>Generated work</th>
                  <th>Abandoned work</th>
                  <th>Peak memory</th>
                  <th>Entries</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map(({strategy, label, result}) => (
                  <ResultRow key={strategy} label={label} result={result} />
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.barGrid}>
            {comparisons.map(({strategy, label, result}) => (
              <div className={styles.barRow} key={strategy}>
                <strong>{label}</strong>
                <span>CPU work</span>
                <div className={styles.track}>
                  <i style={{width: `${result.generatedWorkMs / maxWork * 100}%`}} />
                </div>
                <span>Memory</span>
                <div className={styles.track}>
                  <i style={{width: `${result.peakRetainedBytes / maxMemory * 100}%`}} />
                </div>
              </div>
            ))}
          </div>

          <p className="explanation">
            Timing is modeled generation work, not a wall-clock benchmark. The dependent path is deliberately incremental:
            reaching 8→16→32 costs the same total modeled generation work as directly reaching 32 when no work is
            abandoned. Independent checkpoints regenerate complete LODs, so their extra work and retained memory are
            visible separately.
          </p>
        </div>
      </div>
    </section>
  )
}
