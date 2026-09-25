"use client"

import {type ChangeEvent, useMemo, useState} from "react"
import {
  simulateSpatialWorldStreaming,
  type SpatialBoundaryPolicy,
  type SpatialPriorityStrategy,
  type SpatialWorldStreamingResult,
  WORLDGEN_CACHE_LIMIT,
} from "@/lib/spatial-world-streaming"
import styles from "./spatial-world-streaming-experiment.module.css"

type Scenario = {
  id: string
  label: string
  strategy: SpatialPriorityStrategy
  boundaryPolicy: SpatialBoundaryPolicy
}

const scenarios: Scenario[] = [
  {
    id: "distance-restart",
    label: "Distance · restart",
    strategy: "distance",
    boundaryPolicy: "restart",
  },
  {
    id: "distance-retain",
    label: "Distance · retain",
    strategy: "distance",
    boundaryPolicy: "retain",
  },
  {
    id: "movement-retain",
    label: "Movement · retain",
    strategy: "movement",
    boundaryPolicy: "retain",
  },
  {
    id: "view-retain",
    label: "View · retain",
    strategy: "view",
    boundaryPolicy: "retain",
  },
]

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <label className={`control ${styles.numberControl}`}>
      <span>
        {label}
        <output>{value.toLocaleString()} {unit}</output>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next) && next >= min && next <= max) onChange(next)
        }}
      />
    </label>
  )
}

function formatAverage(value: number | null, misses: number) {
  const average = value === null ? "—" : `${value.toFixed(1)} ms`
  return misses === 0 ? average : `${average} · ${misses} missed`
}

function ScenarioRow({
  scenario,
  result,
}: {
  scenario: Scenario
  result: SpatialWorldStreamingResult
}) {
  return (
    <tr>
      <th scope="row">{scenario.label}</th>
      <td>{result.requestedChunks}</td>
      <td>{result.cacheHits}</td>
      <td>{result.retainedTasks}</td>
      <td>{result.maxQueueDepth}</td>
      <td>{result.wastedGenerationMs.toFixed(0)} ms</td>
      <td>{formatAverage(result.averageFirstUsefulMs, result.missedFirstUsefulWindows)}</td>
      <td>{formatAverage(result.averageNearFieldCompleteMs, result.missedNearFieldWindows)}</td>
    </tr>
  )
}

export function SpatialWorldStreamingExperiment() {
  const [movementIntervalMs, setMovementIntervalMs] = useState(70)
  const [cacheLimit, setCacheLimit] = useState(WORLDGEN_CACHE_LIMIT)

  const comparisons = useMemo(
    () =>
      scenarios.map((scenario) => ({
        scenario,
        result: simulateSpatialWorldStreaming({
          strategy: scenario.strategy,
          boundaryPolicy: scenario.boundaryPolicy,
          movementIntervalMs,
          cacheLimit,
        }),
      })),
    [movementIntervalMs, cacheLimit],
  )
  const queueScale = Math.max(...comparisons.map(({result}) => result.maxQueueDepth), 1)

  return (
    <section className="experiment" id="spatial-world-streaming">
      <header className="experiment-header">
        <div className="experiment-number">11</div>
        <div>
          <h2>Spatial world streaming</h2>
          <p>
            Move a WorldGen-shaped 7×7 chunk window around a deterministic square route and compare restart-on-boundary
            work with retained, reprioritized scheduling.
          </p>
        </div>
      </header>
      <div className="experiment-body">
        <div className="controls">
          <NumberControl
            label="Chunk-boundary interval"
            value={movementIntervalMs}
            min={20}
            max={500}
            step={5}
            unit="ms"
            onChange={setMovementIntervalMs}
          />
          <NumberControl
            label="Cache capacity"
            value={cacheLimit}
            min={49}
            max={256}
            step={1}
            unit="chunks"
            onChange={setCacheLimit}
          />
          <p className={styles.modelNote}>
            Fixed to WorldGen&apos;s active radius and LOD bands: 9 near-field 32×32 chunks, 16 mid-field 16×16 chunks,
            and 24 far-field 8×8 chunks.
          </p>
        </div>
        <div className="visual-panel">
          <div className={styles.tableWrap}>
            <table className={styles.comparisonTable}>
              <thead>
                <tr>
                  <th>Scheduler</th>
                  <th>Requests</th>
                  <th>Cache hits</th>
                  <th>Retained</th>
                  <th>Max pending</th>
                  <th>Stale CPU</th>
                  <th>First useful</th>
                  <th>Near field</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map(({scenario, result}) => (
                  <ScenarioRow scenario={scenario} result={result} key={scenario.id} />
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.queueComparison} aria-label="Pending chunk work over the traversal">
            {comparisons.map(({scenario, result}) => (
              <div className={styles.queueRow} key={scenario.id}>
                <strong>{scenario.label}</strong>
                <div className={styles.queueBars}>
                  {result.steps.map((step) => (
                    <span
                      key={step.index}
                      style={{height: `${Math.max(3, step.queueDepth / queueScale * 100)}%`}}
                      title={`Move ${step.index}: ${step.queueDepth} pending, ${step.requestedChunks} requested, ${step.retainedTasks} retained`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="explanation">
            The initial 7×7 area is warm so the comparison measures traversal rather than startup. Generation cost is a
            deterministic function of chunk coordinate and LOD. “First useful” is the first newly missing near-field or
            view-facing chunk that arrives after a move; “near field” is complete only when every collision-relevant chunk
            for that view is available. Missed windows mean the player crossed another chunk boundary first.
          </p>
        </div>
      </div>
    </section>
  )
}
