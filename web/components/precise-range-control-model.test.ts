import {describe, expect, test} from "bun:test"
import {resolveNumericDraft} from "./precise-range-control-model"

describe("precise numeric draft resolution", () => {
  test("preserves exact fractional values independently of slider granularity", () => {
    expect(resolveNumericDraft("4.125", {min: 0.5, max: 8})).toEqual({
      status: "commit",
      value: 4.125,
    })
  })

  test("accepts exact lower and upper boundaries", () => {
    expect(resolveNumericDraft("-2", {min: -2, max: 3})).toEqual({status: "commit", value: -2})
    expect(resolveNumericDraft("3", {min: -2, max: 3})).toEqual({status: "commit", value: 3})
  })

  test("reverts empty and non-finite drafts instead of coercing them", () => {
    expect(resolveNumericDraft("   ", {min: 0, max: 10})).toEqual({status: "revert", reason: "empty"})
    expect(resolveNumericDraft("not-a-number", {min: 0, max: 10})).toEqual({
      status: "revert",
      reason: "non-finite",
    })
    expect(resolveNumericDraft("1e999", {min: 0, max: 10})).toEqual({
      status: "revert",
      reason: "non-finite",
    })
  })

  test("reverts values outside the active bounds rather than silently clamping", () => {
    expect(resolveNumericDraft("-0.01", {min: 0, max: 10})).toEqual({
      status: "revert",
      reason: "out-of-range",
    })
    expect(resolveNumericDraft("10.01", {min: 0, max: 10})).toEqual({
      status: "revert",
      reason: "out-of-range",
    })
  })

  test("enforces integer-only domains without changing general fractional controls", () => {
    expect(resolveNumericDraft("1500", {min: 1024, max: 131072, integer: true})).toEqual({
      status: "commit",
      value: 1500,
    })
    expect(resolveNumericDraft("1500.5", {min: 1024, max: 131072, integer: true})).toEqual({
      status: "revert",
      reason: "non-integer",
    })
  })

  test("rejects invalid control bounds deterministically", () => {
    expect(() => resolveNumericDraft("1", {min: 2, max: 1})).toThrow("invalid numeric control constraints")
    expect(() => resolveNumericDraft("1", {min: Number.NaN, max: 1})).toThrow(
      "invalid numeric control constraints",
    )
  })
})
