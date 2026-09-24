export type NumericDraftConstraints = {
  min: number
  max: number
  integer?: boolean
}

export type NumericDraftRevertReason = "empty" | "non-finite" | "non-integer" | "out-of-range"

export type NumericDraftResolution =
  | {status: "commit"; value: number}
  | {status: "revert"; reason: NumericDraftRevertReason}

function validateConstraints({min, max}: NumericDraftConstraints) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error("invalid numeric control constraints")
  }
}

export function resolveNumericDraft(
  draft: string,
  constraints: NumericDraftConstraints,
): NumericDraftResolution {
  validateConstraints(constraints)

  const normalized = draft.trim()
  if (normalized === "") {
    return {status: "revert", reason: "empty"}
  }

  const value = Number(normalized)
  if (!Number.isFinite(value)) {
    return {status: "revert", reason: "non-finite"}
  }
  if (constraints.integer === true && !Number.isInteger(value)) {
    return {status: "revert", reason: "non-integer"}
  }
  if (value < constraints.min || value > constraints.max) {
    return {status: "revert", reason: "out-of-range"}
  }

  return {status: "commit", value}
}
