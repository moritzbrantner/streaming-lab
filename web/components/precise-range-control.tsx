"use client"

import {useId, useState} from "react"
import {resolveNumericDraft} from "./precise-range-control-model"
import styles from "./precise-range-control.module.css"

type DraftState = {
  sourceValue: number
  text: string
}

export type PreciseRangeControlProps = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  integer?: boolean
  onChange: (value: number) => void
}

export function PreciseRangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  integer = false,
  onChange,
}: PreciseRangeControlProps) {
  const labelId = useId()
  const [draftState, setDraftState] = useState<DraftState>({
    sourceValue: value,
    text: String(value),
  })
  const draft = draftState.sourceValue === value ? draftState.text : String(value)

  const revert = () => {
    setDraftState({sourceValue: value, text: String(value)})
  }

  const commit = (text: string) => {
    const resolution = resolveNumericDraft(text, {min, max, integer})
    if (resolution.status === "revert") {
      revert()
      return
    }

    setDraftState({sourceValue: resolution.value, text: String(resolution.value)})
    if (resolution.value !== value) {
      onChange(resolution.value)
    }
  }

  const updateFromSlider = (next: number) => {
    setDraftState({sourceValue: next, text: String(next)})
    if (next !== value) {
      onChange(next)
    }
  }

  return (
    <div className={styles.control} role="group" aria-labelledby={labelId}>
      <span className={styles.label} id={labelId}>{label}</span>
      <div className={styles.editor}>
        <input
          className={styles.numberInput}
          type="number"
          min={min}
          max={max}
          step={integer ? 1 : "any"}
          value={draft}
          aria-label={`${label} exact value`}
          onChange={(event) => setDraftState({sourceValue: value, text: event.currentTarget.value})}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit(event.currentTarget.value)
            } else if (event.key === "Escape") {
              event.preventDefault()
              revert()
            }
          }}
        />
        <span className={styles.unit}>{unit}</span>
      </div>
      <input
        className={styles.slider}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label} coarse adjustment`}
        onChange={(event) => updateFromSlider(Number(event.currentTarget.value))}
      />
    </div>
  )
}
