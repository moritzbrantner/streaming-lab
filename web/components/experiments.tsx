"use client"

import {useMemo, useState} from "react"
import {
  calculateChunkingMetrics,
  simulateAdaptiveBitrate,
  simulateBuffer,
  simulateNetwork,
} from "@/lib/models"

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
        onChange={(event) => onChange(Number(event.target.value))}
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

function ExperimentHeader({number, title, summary}: {number: string; title: string; summary: string}) {
  return (
    <header className="experiment-header">
      <div className="experiment-number">{number}</div>
      <div>
        <h2>{title}</h2>
        <p>{summary}</p>
      </div>
    </header>
  )
}

export function ChunkingExperiment() {
  const [chunkBytes, setChunkBytes] = useState(16_384)
  const [framingBytes, setFramingBytes] = useState(32)
  const metrics = useMemo(
    () => calculateChunkingMetrics(1_000_000, chunkBytes, framingBytes, 1_000_000),
    [chunkBytes, framingBytes],
  )

  return (
    <section className="experiment" id="chunking">
      <ExperimentHeader
        number="01"
        title="Chunking: responsiveness versus overhead"
        summary="Smaller chunks can make the first useful bytes available sooner, but every chunk carries framing and bookkeeping overhead."
      />
      <div className="experiment-body">
        <div className="controls">
          <RangeControl label="Chunk size" value={chunkBytes} min={1_024} max={131_072} step={1_024} unit="bytes" onChange={setChunkBytes} />
          <RangeControl label="Framing per chunk" value={framingBytes} min={0} max={256} step={8} unit="bytes" onChange={setFramingBytes} />
        </div>
        <div className="visual-panel">
          <div className="metrics-grid">
            <Metric label="Chunks for 1 MB" value={metrics.chunks.toLocaleString()} />
            <Metric label="Framing overhead" value={`${metrics.overheadBytes.toLocaleString()} B`} />
            <Metric label="Payload efficiency" value={`${metrics.efficiencyPercent.toFixed(2)}%`} />
            <Metric label="First chunk on a 1 MB/s link" value={`${metrics.firstChunkSerializationMs.toFixed(1)} ms`} />
          </div>
          <div className="chunk-track" aria-label="Illustration of payload divided into chunks">
            {Array.from({length: Math.min(metrics.chunks, 24)}, (_, index) => <span key={index} />)}
          </div>
          <p className="explanation">
            This is the first streaming trade-off: latency improves when work is divided, but division is not free. Real protocols add headers, indexes, checksums, encryption records, and scheduling work around each piece.
          </p>
        </div>
      </div>
    </section>
  )
}

export function BackpressureExperiment() {
  const [producerRate, setProducerRate] = useState(60)
  const [consumerRate, setConsumerRate] = useState(35)
  const [capacity, setCapacity] = useState(30)
  const result = useMemo(
    () => simulateBuffer({producerRate, consumerRate, capacity}),
    [producerRate, consumerRate, capacity],
  )

  return (
    <section className="experiment" id="backpressure">
      <ExperimentHeader
        number="02"
        title="Buffers and backpressure"
        summary="A buffer absorbs temporary mismatch. A bounded buffer cannot absorb a permanent mismatch, so pressure must eventually travel upstream."
      />
      <div className="experiment-body">
        <div className="controls">
          <RangeControl label="Producer" value={producerRate} min={0} max={100} unit="chunks/s" onChange={setProducerRate} />
          <RangeControl label="Consumer" value={consumerRate} min={0} max={100} unit="chunks/s" onChange={setConsumerRate} />
          <RangeControl label="Buffer capacity" value={capacity} min={5} max={100} step={5} unit="chunks" onChange={setCapacity} />
        </div>
        <div className="visual-panel">
          <div className="buffer-chart" aria-label="Buffer occupancy over four simulated seconds">
            {result.samples.map((sample) => (
              <div className="buffer-column" key={sample.timeSeconds} title={`${sample.timeSeconds.toFixed(1)}s: ${sample.occupancy.toFixed(1)} chunks`}>
                <span style={{height: `${Math.min(100, (sample.occupancy / capacity) * 100)}%`}} />
              </div>
            ))}
          </div>
          <div className="metrics-grid">
            <Metric label="Accepted production" value={result.totalProduced.toFixed(1)} />
            <Metric label="Consumed" value={result.totalConsumed.toFixed(1)} />
            <Metric label="Blocked upstream" value={result.totalBlocked.toFixed(1)} />
            <Metric label="Consumer starvation steps" value={result.starvationSteps.toString()} />
          </div>
          <p className="explanation">
            When producer rate stays above consumer rate, increasing the buffer only delays the moment of pressure. Backpressure is the mechanism that keeps bounded-memory streaming systems stable instead of pretending the queue can grow forever.
          </p>
        </div>
      </div>
    </section>
  )
}

export function NetworkExperiment() {
  const [lossPercent, setLossPercent] = useState(12)
  const [jitterMs, setJitterMs] = useState(180)
  const [retry, setRetry] = useState(true)
  const result = useMemo(
    () => simulateNetwork({lossPercent, jitterMs, retry}),
    [lossPercent, jitterMs, retry],
  )

  return (
    <section className="experiment" id="network">
      <ExperimentHeader
        number="03"
        title="Loss, jitter, and retry"
        summary="Reliability can recover missing data, but recovery consumes time and bandwidth. Streaming design is often a choice about which failure is cheaper."
      />
      <div className="experiment-body">
        <div className="controls">
          <RangeControl label="Packet loss" value={lossPercent} min={0} max={40} unit="%" onChange={setLossPercent} />
          <RangeControl label="Additional jitter" value={jitterMs} min={0} max={500} step={10} unit="ms" onChange={setJitterMs} />
          <label className="toggle-control">
            <input type="checkbox" checked={retry} onChange={(event) => setRetry(event.target.checked)} />
            <span>Retry one lost transmission</span>
          </label>
        </div>
        <div className="visual-panel">
          <div className="packet-grid" aria-label="Packet outcomes">
            {result.packets.map((packet) => (
              <span
                className={`packet packet-${packet.status}`}
                key={packet.index}
                title={`Packet ${packet.index + 1}: ${packet.status}${packet.latencyMs === null ? "" : ` in ${packet.latencyMs.toFixed(0)} ms`}`}
              >
                {packet.index + 1}
              </span>
            ))}
          </div>
          <div className="legend">
            <span><i className="legend-dot delivered" /> delivered</span>
            <span><i className="legend-dot retried" /> delivered after retry</span>
            <span><i className="legend-dot lost" /> lost</span>
          </div>
          <div className="metrics-grid">
            <Metric label="Delivered" value={`${result.delivered}/${result.packets.length}`} />
            <Metric label="Lost" value={result.lost.toString()} />
            <Metric label="Recovered by retry" value={result.retried.toString()} />
            <Metric label="Average delivered latency" value={`${result.averageLatencyMs.toFixed(0)} ms`} />
          </div>
          <p className="explanation">
            File transfer usually values completeness enough to wait. Live voice may prefer a missing packet over replaying stale audio. The useful question is not “is retry good?” but “what does lateness cost for this stream?”
          </p>
        </div>
      </div>
    </section>
  )
}

export function AdaptiveBitrateExperiment() {
  const [throughput, setThroughput] = useState(4)
  const segments = useMemo(() => simulateAdaptiveBitrate(throughput), [throughput])

  return (
    <section className="experiment" id="media">
      <ExperimentHeader
        number="04"
        title="Adaptive media bitrate"
        summary="Segmented media can trade quality for continuity by selecting a representation that fits recent network throughput with safety headroom."
      />
      <div className="experiment-body">
        <div className="controls">
          <RangeControl label="Typical throughput" value={throughput} min={0.5} max={8} step={0.5} unit="Mbps" onChange={setThroughput} />
          <div className="quality-key">
            <span>240p · 0.35 Mbps</span>
            <span>360p · 0.8 Mbps</span>
            <span>720p · 2.5 Mbps</span>
            <span>1080p · 5 Mbps</span>
          </div>
        </div>
        <div className="visual-panel">
          <div className="segment-list" aria-label="Adaptive bitrate choices over eight media segments">
            {segments.map((segment) => (
              <div className="segment-row" key={segment.index}>
                <span className="segment-index">{segment.index + 1}</span>
                <div className="throughput-track">
                  <span style={{width: `${Math.min(100, (segment.throughputMbps / 8) * 100)}%`}} />
                </div>
                <strong>{segment.throughputMbps.toFixed(1)} Mbps</strong>
                <span className="quality-badge">{segment.quality.label}</span>
              </div>
            ))}
          </div>
          <p className="explanation">
            The model reserves 20% headroom and chooses the highest representation below that safe estimate. Real players also consider buffer depth, recent variance, segment duration, startup state, and switching cost.
          </p>
        </div>
      </div>
    </section>
  )
}
