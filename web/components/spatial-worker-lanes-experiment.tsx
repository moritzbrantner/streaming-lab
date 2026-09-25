"use client"

import {type ChangeEvent, useMemo, useState} from "react"
import {simulateSpatialWorldStreaming, type SpatialWorldStreamingResult} from "@/lib/spatial-world-streaming"
import styles from "./spatial-worker-lanes-experiment.module.css"

const laneCounts = [1, 2, 4] as const

function formatMs(value: number | null, misses: number) {
  const formatted = value === null ? "—" : `${value.toFixed(1)} ms`
  return misses === 0 ? formatted : `${formatted} · ${misses} missed`
}

function ResultRow({
  lanes,
  result,
}: {
  lanes: number
  result: SpatialWorldStreamingResult
}) {
  return (
    <tr>
      <th scope="row">{lanes}</th>
      <td>{formatMs(result.averageFirstUsefulMs, result.missedFirstUsefulWindows)}</td>
      <td>{formatMs(result.averageNearFieldCompleteMs, result.missedNearFieldWindows)}</td>
      <td>{result.maxQueueDepth}</td>
      <td>{result.wastedGenerationMs.toFixed(0)} ms</td>
      <td>{result.durationMs.toFixed(0)} ms</td>
      <td>{result.workerUtilizationPercent.toFixed(1)}%</td>
    </tr>
  )
}

export function SpatialWorkerLanesExperiment() {
  const [movementIntervalMs, setMovementIntervalMs] = useState(35)

  const comparisons = useMemo(
    () =>
      laneCounts.map((workerLanes) => ({
        workerLanes,
        result: simulateSpatialWorldStreaming({
          strategy: "view",
          boundaryPolicy: "retain",
          movementIntervalMs,
          workerLanes,
        }),
      })),
    [movementIntervalMs],
  )

  const maxPending = Math.max(...comparisons.map(({result}) => result.maxQueueDepth), 1)

  return (
    <section className="experiment" id="spatial-worker-lanes">
      <header className="experiment-header">
        <div className="experiment-number">13</div>
        <div>
          <h2>Spatial worker lanes</h2>
          <p>
            Run the same retained, view-prioritized WorldGen-shaped traversal with one, two, or four independent generation
            lanes to expose head-of-line delay and concurrency cost.
          </p>
        </div>
      </header>

      <div className="experiment-body">
        <div className="controls">
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
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next) && next >= 5 && next <= 500) {
                  setMovementIntervalMs(next)
                }
              }}
            />
          </label>
          <p className={styles.note}>
            Lanes share one deterministic priority queue. Running work is non-preemptive, so a single lane can remain
            occupied by older useful work while a newly urgent near-field chunk waits behind it.
          </p>
        </div>

        <div className="visual-panel">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Lanes</th>
                  <th>First useful</th>
                  <th>Near field</th>
                  <th>Max pending</th>
                  <th>Stale CPU</th>
                  <th>Drain duration</th>
                  <th>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map(({workerLanes, result}) => (
                  <ResultRow key={workerLanes} lanes={workerLanes} result={result} />
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.queueRows}>
            {comparisons.map(({workerLanes, result}) => (
              <div className={styles.queueRow} key={workerLanes}>
                <strong>{workerLanes} lane{workerLanes === 1 ? "" : "s"}</strong>
                <div className={styles.track}>
                  <i style={{width: `${result.maxQueueDepth / maxPending * 100}%`}} />
                </div>
                <span>{result.maxQueueDepth} max pending · {result.maxBusyWorkers} busy</span>
              </div>
            ))}
          </div>

          <p className="explanation">
            More lanes improve completion only by executing independent chunk jobs concurrently; they do not change LOD,
            cache, priority, or cancellation semantics. Utilization is modeled busy time divided by available lane time,
            while stale CPU counts work that finished after it stopped being useful.
          </p>
        </div>
      </div>
    </section>
  )
}
