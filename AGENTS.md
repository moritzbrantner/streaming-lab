# Streaming Lab Agent Instructions

Streaming Lab is a browser-first collection of deterministic, inspectable streaming experiments. Experiment semantics and measurements remain independent from React and presentation code.

## Interactive experiment UX

- Interactive experiment pages apply the current shared `ui` conventions from `moritzbrantner/coding-agent-conventions`, especially `PRINCIPLE-009`, `UI-008`, `UI-012`, and `UI-013`.
- Treat the experiment visualization and current workload state as the primary surface. Keep controls compact and adjacent to the behavior they change; do not bury the experiment below explanatory or dashboard-style chrome.
- Keep workload parameters precision-first with exact numeric entry. Sliders, spatial dragging, timeline scrubbing, or other direct manipulation may supplement exact inputs when they make a trade-off easier to inspect, but all controls must update the same authoritative experiment state.
- Give each pan/zoom/drag/scrub/selection interaction one owner. Presentation adapters must not duplicate scheduler or simulation state to drive a second interaction model.
- Show measurements where they explain the currently visible trade-off. Do not promote incidental counts into standalone KPI cards.
- Protect browser-dependent hit geometry, viewport placement, clipping, and direct-manipulation behavior with focused browser evidence when the experiment relies on them.

## Authority boundaries

- Deterministic experiment models under `web/lib` remain independent from React, Next.js, and presentation components.
- UI code may project experiment state but must not redefine scheduling, buffering, delivery, provenance, or measurement semantics.

## Verification

Run `bun run check` as the repository-owned completion gate after narrower affected tests.
