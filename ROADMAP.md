# Streaming Lab roadmap

The roadmap is organized around observable streaming behavior rather than protocols for their own sake.

## Layer 1 — streaming fundamentals

- [x] Chunk size versus framing overhead and first-chunk serialization time.
- [x] Bounded buffers and backpressure.
- [x] Loss, jitter, and retry behavior.
- [x] Adaptive bitrate selection from changing throughput.
- [ ] Watermarks and queue-pressure policies.
- [ ] Head-of-line blocking versus independent streams.

## Layer 2 — real browser streams

- [ ] Build a `ReadableStream -> TransformStream -> WritableStream` experiment.
- [ ] Visualize `desiredSize`, pull pressure, cancellation, and abort propagation.
- [ ] Compare byte streams with object streams.
- [ ] Add `CompressionStream` / `DecompressionStream` experiments where supported.

## Layer 3 — audio and video delivery

- [ ] Progressive download versus segmented delivery.
- [ ] Media Source Extensions buffer visualization.
- [ ] Segment duration, startup latency, and rebuffering experiments.
- [ ] Audio chunking and jitter-buffer experiment.
- [ ] WebCodecs frame pipeline when browser support and static hosting make the experiment useful.

## Layer 4 — robustness

- [ ] Retry and exponential-backoff timing.
- [ ] Checksums and corruption detection.
- [ ] Simple parity / forward-error-correction visualization.
- [ ] Reordering, duplication, and idempotent consumption.
- [ ] Resume-from-offset and checkpointing.

## Layer 5 — transport comparisons

- [ ] HTTP chunked/streaming response model.
- [ ] HTTP/2 multiplexing and head-of-line behavior.
- [ ] HTTP/3 / QUIC conceptual experiment.
- [ ] WebSocket message flow.
- [ ] WebTransport and WebRTC data/media paths where a static client can demonstrate them honestly.

## Layer 6 — reusable kernels

Introduce Rust/WASM only where it creates a useful reusable primitive, for example:

- parity/FEC coding,
- checksums,
- packetization,
- compression experiments,
- codec-oriented transforms,
- high-volume simulation.

The web layer should remain the explanation and visualization surface; reusable algorithms should live behind small typed boundaries.
