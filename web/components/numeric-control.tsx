"use client"

import {type KeyboardEvent, useId, useState} from "react"

export type NumericBounds = {min: number; max: number}

export type NumericDraftResolution =
  | {status: "commit"; value: number}
  | {status: "revert"; value: number; reason: "empty" | "invalid" | "out-of-range"}

// One draft policy for every experiment parameter: an exact, finite, in-range number commits as
// typed (no step quantization); anything else reverts to the current value instead of being coerced.
export function resolveNumericDraft(draft: string, {min, max}: NumericBounds, current: number): NumericDraftResolution {
  const trimmed = draft.trim()
  if (trimmed === "") {
    return {status: "revert", value: current, reason: "empty"}
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    return {status: "revert", value: current, reason: "invalid"}
  }
  if (parsed < min || parsed > max) {
    return {status: "revert", value: current, reason: "out-of-range"}
  }
  return {status: "commit", value: parsed}
}

export function NumericControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  slider = false,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  slider?: boolean
  onCommit: (value: number) => void
}) {
  // `null` means "not editing": the input shows the authoritative value, so external changes
  // (the slider, dependent bounds, resets) are reflected immediately.
  const [draft, setDraft] = useState<string | null>(null)
  const unitId = useId()

  const commitDraft = (text: string) => {
    const resolution = resolveNumericDraft(text, {min, max}, value)
    setDraft(null)
    if (resolution.status === "commit" && resolution.value !== value) {
      onCommit(resolution.value)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commitDraft(event.currentTarget.value)
    } else if (event.key === "Escape") {
      event.preventDefault()
      setDraft(null)
    }
  }

  return (
    <label className="control">
      <span>
        {label}
        <span className="numeric-editor">
          <input
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={draft ?? String(value)}
            aria-describedby={unitId}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={(event) => {
              if (draft !== null) {
                commitDraft(event.currentTarget.value)
              }
            }}
            onKeyDown={handleKeyDown}
          />
          <small id={unitId}>{unit}</small>
        </span>
      </span>
      {slider ? (
        <input
          type="range"
          aria-label={`${label} (${unit}, coarse adjustment)`}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            setDraft(null)
            onCommit(Number(event.currentTarget.value))
          }}
        />
      ) : null}
    </label>
  )
}
