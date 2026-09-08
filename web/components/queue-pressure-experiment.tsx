"use client"

import {type ChangeEvent, useMemo, useState} from "react"
import {simulateQueuePressure, type QueuePressurePolicy} from "@/lib/queue-pressure"
import styles from "./queue-pressure-experiment.module.css"

const policyLabels: Record<QueuePressurePolicy, string> = {
  pause: "Pause / resume",
  "drop-newest": "Drop newest",
  "drop-oldest": "Drop oldest",
}

const policyExplanations: Record<QueuePressurePolicy, string> = {
  pause:
    "The high watermark pauses the producer and the low watermark releases it. The gap creates hysteresis, which prevents rapid pause/resume oscillation around one threshold.",
  "drop-newest":
    "New arrivals are discarded once the queue reaches the high watermark. Existing queued work is preserved, which favors completeness of older work over freshness.",
  "drop-oldest":
    "Queued work is evicted once pressure reaches the high watermark so fresher arrivals can enter. This sacrifices backlog to keep the stream closer to the present.",
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

export function QueuePressureExperiment() {
  const [producerRate, setProducerRate] = useState(70)
  const [consumerRate, setConsumerRate] = useState(30)
  const [capacity, setCapacity] = useState(40)
  const [lowWatermarkPercent, setLowWatermarkPercent] = useState(35)
  const [highWatermarkPercent, setHighWatermarkPercent] = useState(75)
  const [policy, setPolicy] = useState<QueuePressurePolicy>("pause")

  const result = useMemo(
    () =>
      simulateQueuePressure({
        producerRate,
        consumerRate,
        capacity,
        lowWatermarkPercent,
        highWatermarkPercent,
        policy,
      }),
    [producerRate, consumerRate, capacity, lowWatermarkPercent, highWatermarkPercent, policy],
  )

  return (
    <section className="experiment" id="watermarks">
      <header className="experiment-header">
        <div className="experiment-number">05</div>
        <div>
          <h2>Watermarks and queue-pressure policies</h2>
          <p>
            Pressure does not have to wait for a full queue. High and low watermarks let a system react early, while the
            policy decides whether overload slows the producer or discards work.
          </p>
        </div>
      </header>
      <div className="experiment-body">
        <div className="controls">
          <RangeControl label="Producer" value={producerRate} min={0} max={100} unit="chunks/s" onChange={setProducerRate} />
          <RangeControl label="Consumer" value={consumerRate} min={0} max={100} unit="chunks/s" onChange={setConsumerRate} />
          <RangeControl label="Queue capacity" value={capacity} min={20} max={100} step={5} unit="chunks" onChange={setCapacity} />
          <RangeControl
            label="Low watermark"
            value={lowWatermarkPercent}
            min={5}
            max={highWatermarkPercent - 5}
            step={5}
            unit="%"
            onChange={setLowWatermarkPercent}
          />
          <RangeControl
            label="High watermark"
            value={highWatermarkPercent}
            min={lowWatermarkPercent + 5}
            max={95}
            step={5}
            unit="%"
            onChange={setHighWatermarkPercent}
          />
          <label className="control">
            <span>Pressure policy</span>
            <select
              className={styles.policySelect}
              value={policy}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setPolicy(event.target.value as QueuePressurePolicy)}
            >
              {Object.entries(policyLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="visual-panel">
          <div className={styles.chart} aria-label="Queue occupancy with low and high watermarks">
            <span
              className={`${styles.watermarkLine} ${styles.highWatermark}`}
              style={{bottom: `${highWatermarkPercent}%`}}
              aria-hidden="true"
            >
              <i>high</i>
            </span>
            <span
              className={`${styles.watermarkLine} ${styles.lowWatermark}`}
              style={{bottom: `${lowWatermarkPercent}%`}}
              aria-hidden="true"
            >
              <i>low</i>
            </span>
            {result.samples.map((sample) => {
              const discarded = sample.droppedIncomingInStep + sample.evictedQueuedInStep
              return (
                <div
                  className={`${styles.column} ${sample.pressured ? styles.pressured : ""} ${sample.producerPaused ? styles.paused : ""}`}
                  key={sample.timeSeconds}
                  title={`${sample.timeSeconds.toFixed(1)}s: ${sample.occupancy.toFixed(1)} queued, ${sample.blockedInStep.toFixed(1)} blocked, ${discarded.toFixed(1)} discarded`}
                >
                  <span style={{height: `${Math.min(100, (sample.occupancy / capacity) * 100)}%`}} />
                </div>
              )
            })}
          </div>
          <div className="legend">
            <span><i className={`${styles.legendDot} ${styles.normalDot}`} /> normal</span>
            <span><i className={`${styles.legendDot} ${styles.pressureDot}`} /> pressure action</span>
            <span><i className={`${styles.legendDot} ${styles.pausedDot}`} /> producer paused</span>
          </div>
          <div className="metrics-grid">
            <Metric label="Blocked upstream" value={result.totalBlocked.toFixed(1)} />
            <Metric label="Dropped incoming" value={result.totalDroppedIncoming.toFixed(1)} />
            <Metric label="Evicted queued" value={result.totalEvictedQueued.toFixed(1)} />
            <Metric label="Pressure transitions" value={result.pressureTransitions.toString()} />
          </div>
          <p className="explanation">
            <strong>{policyLabels[policy]}:</strong> {policyExplanations[policy]}
          </p>
        </div>
      </div>
    </section>
  )
}
