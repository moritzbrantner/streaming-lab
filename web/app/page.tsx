import {
  AdaptiveBitrateExperiment,
  BackpressureExperiment,
  ChunkingExperiment,
  NetworkExperiment,
} from "@/components/experiments"
import {ObjectStreamingExperiment} from "@/components/object-streaming-experiment"
import {QueuePressureExperiment} from "@/components/queue-pressure-experiment"

const concepts = [
  ["Time", "A stream has useful behavior only when you care when each piece becomes available."],
  ["Bounded memory", "Buffers smooth bursts, but finite buffers eventually force backpressure, dropping, or failure."],
  ["Uncertainty", "Bandwidth, latency, jitter, loss, and consumer speed change while a stream is in flight."],
]

export default function Home() {
  return (
    <main>
      <section className="hero shell">
        <p className="eyebrow">Streaming Lab</p>
        <h1>Make streaming behavior visible.</h1>
        <p className="lede">
          Streaming is not just sending bytes in smaller pieces. It is the interaction between time, bounded memory,
          producer and consumer speed, and an unreliable path between them.
        </p>
        <nav className="jump-links" aria-label="Experiments">
          <a href="#chunking">Chunking</a>
          <a href="#backpressure">Backpressure</a>
          <a href="#network">Network</a>
          <a href="#media">Media bitrate</a>
          <a href="#watermarks">Watermarks</a>
          <a href="#objects-3d">3D objects</a>
        </nav>
      </section>

      <section className="shell principle-grid" aria-label="Core streaming constraints">
        {concepts.map(([title, copy]) => (
          <article className="principle" key={title}>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section className="shell intro">
        <p className="section-kicker">Layer 1</p>
        <h2>Small models, one mental model</h2>
        <p>
          Change one variable at a time. The numbers are deliberately simplified so the causal relationship stays
          inspectable before later experiments introduce real browser streams, media buffers, object formats, codecs,
          and transports.
        </p>
      </section>

      <div className="shell experiment-stack">
        <ChunkingExperiment />
        <BackpressureExperiment />
        <NetworkExperiment />
        <AdaptiveBitrateExperiment />
        <QueuePressureExperiment />
        <ObjectStreamingExperiment />
      </div>

      <section className="shell next-layer">
        <p className="section-kicker">Next layer</p>
        <h2>From models to real streaming APIs</h2>
        <p>
          The next experiments will replace selected models with actual browser primitives: Web Streams for pressure
          propagation, CompressionStream for transforms, Media Source Extensions for segmented playback, progressive
          3D manifests for real mesh assets, and WebCodecs where it improves the explanation rather than merely adding
          technology.
        </p>
      </section>
    </main>
  )
}
