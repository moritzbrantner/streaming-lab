// Acceptance for #11: one shared precision-first numeric control.
//
// Pinned surface (independent acceptance, written before the implementation):
// - `web/components/numeric-control.tsx` exports `NumericControl` and the pure draft policy
//   `resolveNumericDraft(draft, {min, max}, current)`.
// - `resolveNumericDraft` returns `{status: "commit", value}` for an exact in-range number, or
//   `{status: "revert", value: current, reason}` with reason "empty" | "invalid" | "out-of-range".
//   Typed values are never quantized to a slider step, and an empty draft is never coerced to 0.
// - `NumericControl` renders a directly editable `<input type="number">` with the unit visible
//   inside the same `<label>`; `slider` adds an optional `<input type="range">` coarse affordance.
import {describe, expect, test} from "bun:test"
import {readFile} from "node:fs/promises"
import {createElement} from "react"
import {renderToStaticMarkup} from "react-dom/server"

import {NumericControl, resolveNumericDraft} from "./numeric-control"

const bounds = {min: 0.5, max: 20}

describe("resolveNumericDraft", () => {
  test("commits exact fractional values without quantizing them to a slider step", () => {
    expect(resolveNumericDraft("2.37", bounds, 5)).toEqual({status: "commit", value: 2.37})
    expect(resolveNumericDraft("0.1", {min: 0, max: 1}, 0.5)).toEqual({status: "commit", value: 0.1})
    expect(resolveNumericDraft("13.0625", bounds, 5)).toEqual({status: "commit", value: 13.0625})
  })

  test("accepts surrounding whitespace and exponent notation as exact numbers", () => {
    expect(resolveNumericDraft("  7.5  ", bounds, 5)).toEqual({status: "commit", value: 7.5})
    expect(resolveNumericDraft("1.5e1", bounds, 5)).toEqual({status: "commit", value: 15})
  })

  test("boundaries are inclusive", () => {
    expect(resolveNumericDraft("0.5", bounds, 5)).toEqual({status: "commit", value: 0.5})
    expect(resolveNumericDraft("20", bounds, 5)).toEqual({status: "commit", value: 20})
    expect(resolveNumericDraft("0", {min: 0, max: 300}, 10)).toEqual({status: "commit", value: 0})
  })

  test("empty drafts revert to the current value instead of becoming zero", () => {
    for (const draft of ["", "   "]) {
      expect(resolveNumericDraft(draft, {min: 0, max: 100}, 42)).toEqual({
        status: "revert",
        value: 42,
        reason: "empty",
      })
    }
  })

  test("non-numeric and non-finite drafts revert", () => {
    for (const draft of ["abc", "1.2.3", "NaN", "Infinity", "-Infinity", "1e400", "12px"]) {
      expect(resolveNumericDraft(draft, {min: -1e308, max: 1e308}, 3)).toEqual({
        status: "revert",
        value: 3,
        reason: "invalid",
      })
    }
  })

  test("out-of-range drafts revert deliberately and never commit outside the bounds", () => {
    for (const draft of ["0.49", "20.0001", "-1", "1000"]) {
      const result = resolveNumericDraft(draft, bounds, 5)
      expect(result).toEqual({status: "revert", value: 5, reason: "out-of-range"})
    }
  })
})

describe("NumericControl", () => {
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(NumericControl, {
        label: "Bandwidth",
        value: 2.5,
        min: 0.5,
        max: 20,
        step: 0.5,
        unit: "Mbps",
        onCommit: () => {},
        ...props,
      }),
    )

  test("renders a directly editable number input with its current exact value and bounds", () => {
    const markup = render({value: 2.37})
    expect(markup).toMatch(/<input[^>]*type="number"/)
    expect(markup).toMatch(/<input[^>]*type="number"[^>]*value="2\.37"|<input[^>]*value="2\.37"[^>]*type="number"/)
    expect(markup).toMatch(/min="0\.5"/)
    expect(markup).toMatch(/max="20"/)
  })

  test("keeps the label and unit visible inside the same label element", () => {
    const markup = render({})
    const label = markup.match(/<label[\s\S]*<\/label>/)?.[0] ?? ""
    expect(label).toContain("Bandwidth")
    expect(label).toContain("Mbps")
    expect(label).toMatch(/type="number"/)
  })

  test("the slider is an optional coarse affordance next to the exact input", () => {
    expect(render({})).not.toMatch(/type="range"/)
    const withSlider = render({slider: true})
    expect(withSlider).toMatch(/type="range"/)
    expect(withSlider).toMatch(/type="number"/)
  })
})

describe("duplicate controls are removed", () => {
  for (const file of ["experiments.tsx", "queue-pressure-experiment.tsx", "object-streaming-experiment.tsx"]) {
    test(`${file} uses the shared control`, async () => {
      const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8")
      expect(source).not.toMatch(/function RangeControl\b/)
      expect(source).not.toMatch(/type="range"/)
      expect(source).toMatch(/from "\.\/numeric-control"|from "@\/components\/numeric-control"/)
    })
  }
})
