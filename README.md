# Streaming Lab

Streaming Lab is a browser-first collection of interactive experiments for understanding how data moves over time when bandwidth, memory, latency, and delivery are constrained.

The lab follows the same learning-by-experiment approach as Collision Lab: explain one primitive, make the trade-off visible, and keep the model small enough to inspect.

## First experiments

- **Chunking** — see how chunk size trades first-byte latency against framing overhead.
- **Buffers and backpressure** — vary producer rate, consumer rate, and buffer capacity to see when bounded memory forces the producer to slow down.
- **Loss, jitter, and retry** — inspect packet delivery when the network becomes unreliable.
- **Adaptive media bitrate** — see how a segmented media player can select quality from measured throughput.
- **Watermarks and queue pressure** — compare pause/resume hysteresis with dropping newest or oldest queued work before the queue reaches capacity.

## Architecture

The first slice is intentionally browser-first. The models live in TypeScript and the interactive site is a statically exported Next.js application deployed to GitHub Pages. Rust/WASM is deferred until an experiment benefits from compute-heavy codecs, parity/FEC, compression, or another reusable kernel.

## Local development

```bash
cd web
bun install
bun test
bun run typecheck
bun run dev
```

Build the static Pages output with:

```bash
bun run build
```

## Deployment

Pushes to `main` run tests, type checking, and the static build before deploying `web/out` to GitHub Pages.

See [ROADMAP.md](ROADMAP.md) for the next experiment layers.
