# Streaming Lab roadmap

The roadmap is organized around observable streaming behavior rather than protocols for their own sake.

## Layer 1 — streaming fundamentals

- [x] Chunk size versus framing overhead and first-chunk serialization time.
- [x] Bounded buffers and backpressure.
- [x] Loss, jitter, and retry behavior.
- [x] Adaptive bitrate selection from changing throughput.
- [x] Watermarks and queue-pressure policies.
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

## Layer 4 — 3D object delivery

- [x] Model proxy-first LOD delivery, packet loss, retry, dependent refinements, and independent LOD checkpoints.
- [ ] Stream a real static 3D asset from a small manifest with independently addressable LOD packages.
- [ ] Verify package hashes before promoting a newly received LOD.
- [ ] Compare complete LOD checkpoints with delta/refinement packages using the same source mesh.
- [ ] Add geometry compression and measure decode cost versus bytes saved.
- [ ] Prioritize visible or nearby mesh regions once the whole-object LOD path is deterministic.
- [ ] Explore parity/FEC for high-priority base geometry before adding more transport-specific behavior.

## Layer 5 — robustness

- [ ] Retry and exponential-backoff timing.
- [ ] Checksums and corruption detection.
- [ ] Simple parity / forward-error-correction visualization.
- [ ] Reordering, duplication, and idempotent consumption.
- [ ] Resume-from-offset and checkpointing.

## Layer 6 — transport comparisons

- [ ] HTTP chunked/streaming response model.
- [ ] HTTP/2 multiplexing and head-of-line behavior.
- [ ] HTTP/3 / QUIC conceptual experiment.
- [ ] WebSocket message flow.
- [ ] WebTransport and WebRTC data/media paths where a static client can demonstrate them honestly.

## Layer 7 — reusable kernels

Introduce Rust/WASM only where it creates a useful reusable primitive, for example:

- parity/FEC coding,
- checksums,
- packetization,
- compression experiments,
- codec-oriented transforms,
- high-volume simulation.

The web layer should remain the explanation and visualization surface; reusable algorithms should live behind small typed boundaries.
