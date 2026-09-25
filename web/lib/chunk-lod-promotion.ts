import {
  planSpatialView,
  type SpatialChunkCoord,
  type SpatialChunkPlan,
  worldgenChunkGenerationCostMs,
  worldgenSquareTraversal,
} from "./spatial-world-streaming"

export type ChunkLodPromotionStrategy =
  | "direct"
  | "dependent-refinements"
  | "independent-checkpoints"

export type ChunkLodPromotionStep = {
  index: number
  atMs: number
  center: SpatialChunkCoord
  firstRenderableMs: number | null
  nearFieldCompleteMs: number | null
  pendingTasks: number
}

export type ChunkLodPromotionResult = {
  steps: ChunkLodPromotionStep[]
  generatedWorkMs: number
  discardedWorkMs: number
  cancelledQueuedWorkMs: number
  completedTasks: number
  staleCompletions: number
  promotions: number
  peakRetainedEntries: number
  peakRetainedBytes: number
  averageFirstRenderableMs: number | null
  missedFirstRenderableWindows: number
  averageNearFieldCompleteMs: number | null
  missedNearFieldWindows: number
}

export type ChunkLodPromotionInput = {
  strategy: ChunkLodPromotionStrategy
  route?: readonly SpatialChunkCoord[]
  movementIntervalMs?: number
  warmStart?: boolean
}

type ChunkResolution = 8 | 16 | 32
type CacheEntry = {
  x: number
  z: number
  resolution: ChunkResolution
  bytes: number
  lastUsedMs: number
}
type PromotionTask = {
  key: string
  coordinateKey: string
  x: number
  z: number
  resolution: ChunkResolution
  workMs: number
  priority: number
  obsolete: boolean
}
type RunningTask = PromotionTask & {
  startedAtMs: number
  finishAtMs: number
}

const resolutions: readonly ChunkResolution[] = [8, 16, 32]

export const chunkLodScenarioRoutes = {
  stationary: [[0, 0]] as const satisfies readonly SpatialChunkCoord[],
  steady: worldgenSquareTraversal,
  reversal: [
    [0, 0],
    [1, 0],
    [0, 0],
    [1, 0],
    [0, 0],
  ] as const satisfies readonly SpatialChunkCoord[],
}

function coordinateKey(x: number, z: number) {
  return `${x}:${z}`
}

function cacheKey(x: number, z: number, resolution: ChunkResolution) {
  return `${coordinateKey(x, z)}:${resolution}`
}

function chunkGeometryBytes(resolution: ChunkResolution) {
  const vertices = (resolution + 1) ** 2
  const triangles = resolution ** 2 * 2
  return vertices * 49 + triangles * 12
}

function direction(from: SpatialChunkCoord, to: SpatialChunkCoord): readonly [number, number] {
  const x = to[0] - from[0]
  const z = to[1] - from[1]
  const length = Math.hypot(x, z)
  return length === 0 ? [0, 0] : [x / length, z / length]
}

function stageWorkMs(
  strategy: ChunkLodPromotionStrategy,
  x: number,
  z: number,
  resolution: ChunkResolution,
) {
  const total = worldgenChunkGenerationCostMs(x, z, resolution)
  if (strategy !== "dependent-refinements") return total
  if (resolution === 8) return total

  const previous = resolution === 16 ? 8 : 16
  return Math.max(1, total - worldgenChunkGenerationCostMs(x, z, previous))
}

function stageBias(resolution: ChunkResolution) {
  return resolution === 8 ? 0 : resolution === 16 ? 0.1 : 0.2
}

function mean(values: number[]) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function simulateChunkLodPromotion({
  strategy,
  route = chunkLodScenarioRoutes.steady,
  movementIntervalMs = 70,
  warmStart = true,
}: ChunkLodPromotionInput): ChunkLodPromotionResult {
  if (route.length === 0 || route.some(([x, z]) => !Number.isInteger(x) || !Number.isInteger(z))) {
    throw new Error("chunk LOD promotion requires integer chunk coordinates")
  }
  if (!Number.isFinite(movementIntervalMs) || movementIntervalMs <= 0) {
    throw new Error("movement interval must be greater than zero")
  }

  const cache = new Map<string, CacheEntry>()
  let currentDesired = new Map<string, SpatialChunkPlan>()
  let queue: PromotionTask[] = []
  const worker: {running: RunningTask | null} = {running: null}
  let timeMs = 0
  let currentStep: ChunkLodPromotionStep | null = null
  let invisibleCoordinates = new Set<string>()
  let incompleteNearField = new Set<string>()

  const steps: ChunkLodPromotionStep[] = []
  let generatedWorkMs = 0
  let discardedWorkMs = 0
  let cancelledQueuedWorkMs = 0
  let completedTasks = 0
  let staleCompletions = 0
  let promotions = 0
  let peakRetainedEntries = 0
  let peakRetainedBytes = 0

  const bestResolution = (x: number, z: number): ChunkResolution | null => {
    let best: ChunkResolution | null = null
    for (const entry of cache.values()) {
      if (entry.x === x && entry.z === z && (best === null || entry.resolution > best)) {
        best = entry.resolution
      }
    }
    return best
  }

  const hasResolution = (x: number, z: number, resolution: ChunkResolution) =>
    cache.has(cacheKey(x, z, resolution))

  const canRender = (plan: SpatialChunkPlan) => {
    const best = bestResolution(plan.x, plan.z)
    return best !== null
  }

  const satisfiesTarget = (plan: SpatialChunkPlan) => {
    const best = bestResolution(plan.x, plan.z)
    return best !== null && best >= plan.resolution
  }

  const recordMemory = () => {
    peakRetainedEntries = Math.max(peakRetainedEntries, cache.size)
    peakRetainedBytes = Math.max(
      peakRetainedBytes,
      [...cache.values()].reduce((total, entry) => total + entry.bytes, 0),
    )
  }

  const storeCompletion = (task: PromotionTask) => {
    const previousBest = bestResolution(task.x, task.z)
    if (strategy === "dependent-refinements") {
      const prefix = `${task.coordinateKey}:`
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key)
      }
    }
    cache.set(cacheKey(task.x, task.z, task.resolution), {
      x: task.x,
      z: task.z,
      resolution: task.resolution,
      bytes: chunkGeometryBytes(task.resolution),
      lastUsedMs: timeMs,
    })
    if (previousBest !== null && task.resolution > previousBest) promotions += 1
    recordMemory()
  }

  const outstandingKeys = () => {
    const keys = new Set(queue.filter((task) => !task.obsolete).map((task) => task.key))
    if (worker.running !== null && !worker.running.obsolete) keys.add(worker.running.key)
    return keys
  }

  const desiredStages = (plan: SpatialChunkPlan): ChunkResolution[] => {
    const current = bestResolution(plan.x, plan.z)
    if (current !== null && current >= plan.resolution) return []
    if (strategy === "direct") return [plan.resolution]

    const missing = resolutions.filter(
      (resolution) =>
        resolution <= plan.resolution &&
        (current === null || resolution > current) &&
        !hasResolution(plan.x, plan.z, resolution),
    )
    return strategy === "dependent-refinements" ? missing.slice(0, 1) : missing
  }

  const ensureTasks = () => {
    const outstanding = outstandingKeys()
    for (const plan of currentDesired.values()) {
      for (const resolution of desiredStages(plan)) {
        const key = cacheKey(plan.x, plan.z, resolution)
        if (outstanding.has(key)) continue
        queue.push({
          key,
          coordinateKey: coordinateKey(plan.x, plan.z),
          x: plan.x,
          z: plan.z,
          resolution,
          workMs: stageWorkMs(strategy, plan.x, plan.z, resolution),
          priority: plan.priority + stageBias(resolution),
          obsolete: false,
        })
        outstanding.add(key)
        if (strategy === "dependent-refinements") break
      }
    }
  }

  const sortQueue = () => {
    queue.sort(
      (left, right) =>
        left.priority - right.priority ||
        left.resolution - right.resolution ||
        left.key.localeCompare(right.key),
    )
  }

  const startNext = () => {
    if (worker.running !== null || queue.length === 0) return
    sortQueue()
    const next = queue.shift()
    if (next === undefined) return
    worker.running = {
      ...next,
      startedAtMs: timeMs,
      finishAtMs: timeMs + next.workMs,
    }
  }

  const updateStepReadiness = () => {
    if (currentStep === null) return

    for (const key of [...invisibleCoordinates]) {
      const plan = currentDesired.get(key)
      if (plan !== undefined && canRender(plan)) {
        invisibleCoordinates.delete(key)
        if (currentStep.firstRenderableMs === null) {
          currentStep.firstRenderableMs = timeMs - currentStep.atMs
        }
      }
    }

    for (const key of [...incompleteNearField]) {
      const plan = currentDesired.get(key)
      if (plan !== undefined && satisfiesTarget(plan)) incompleteNearField.delete(key)
    }
    if (currentStep.nearFieldCompleteMs === null && incompleteNearField.size === 0) {
      currentStep.nearFieldCompleteMs = timeMs - currentStep.atMs
    }
  }

  const completeRunning = () => {
    const completed = worker.running
    if (completed === null) return
    worker.running = null
    generatedWorkMs += completed.workMs

    const desired = currentDesired.get(completed.coordinateKey)
    if (
      completed.obsolete ||
      desired === undefined ||
      completed.resolution > desired.resolution
    ) {
      staleCompletions += 1
      discardedWorkMs += completed.workMs
      return
    }

    completedTasks += 1
    storeCompletion(completed)
    updateStepReadiness()
    ensureTasks()
  }

  const advanceTo = (targetMs: number) => {
    startNext()
    while (worker.running !== null && worker.running.finishAtMs <= targetMs) {
      timeMs = worker.running.finishAtMs
      completeRunning()
      startNext()
    }
    timeMs = targetMs
  }

  const planAt = (index: number) => {
    const center = route[index]
    if (center === undefined) throw new Error("missing traversal center")
    const previous = route[index - 1] ?? center
    const next = route[index + 1] ?? center
    const movement = direction(previous, center)
    const view = direction(center, next)
    return planSpatialView({
      center,
      movement: movement[0] === 0 && movement[1] === 0 ? view : movement,
      view: view[0] === 0 && view[1] === 0 ? movement : view,
      strategy: "view",
    })
  }

  if (warmStart) {
    const initialPlans = planAt(0)
    currentDesired = new Map(
      initialPlans.map((plan) => [coordinateKey(plan.x, plan.z), plan] as const),
    )
    for (const plan of initialPlans) {
      cache.set(cacheKey(plan.x, plan.z, plan.resolution), {
        x: plan.x,
        z: plan.z,
        resolution: plan.resolution,
        bytes: chunkGeometryBytes(plan.resolution),
        lastUsedMs: 0,
      })
    }
    recordMemory()
  }

  const firstEvent = warmStart ? 1 : 0
  for (let index = firstEvent; index < route.length; index += 1) {
    const eventTimeMs = (index - firstEvent) * movementIntervalMs
    advanceTo(eventTimeMs)

    const plans = planAt(index)
    const nextDesired = new Map(
      plans.map((plan) => [coordinateKey(plan.x, plan.z), plan] as const),
    )

    queue = queue.flatMap((task) => {
      const desired = nextDesired.get(task.coordinateKey)
      if (desired === undefined || task.resolution > desired.resolution || task.obsolete) {
        cancelledQueuedWorkMs += task.workMs
        return []
      }
      return [{...task, priority: desired.priority + stageBias(task.resolution)}]
    })
    if (worker.running !== null && !worker.running.obsolete) {
      const desired = nextDesired.get(worker.running.coordinateKey)
      if (desired === undefined || worker.running.resolution > desired.resolution) {
        worker.running.obsolete = true
      }
    }

    currentDesired = nextDesired
    for (const plan of plans) {
      for (const entry of cache.values()) {
        if (entry.x === plan.x && entry.z === plan.z) entry.lastUsedMs = timeMs
      }
    }

    invisibleCoordinates = new Set(
      plans.filter((plan) => !canRender(plan)).map((plan) => coordinateKey(plan.x, plan.z)),
    )
    incompleteNearField = new Set(
      plans
        .filter((plan) => plan.collision && !satisfiesTarget(plan))
        .map((plan) => coordinateKey(plan.x, plan.z)),
    )

    currentStep = {
      index,
      atMs: timeMs,
      center: route[index]!,
      firstRenderableMs: invisibleCoordinates.size === 0 ? 0 : null,
      nearFieldCompleteMs: incompleteNearField.size === 0 ? 0 : null,
      pendingTasks: 0,
    }
    steps.push(currentStep)

    ensureTasks()
    sortQueue()
    currentStep.pendingTasks = queue.length + (worker.running === null ? 0 : 1)
    startNext()
  }

  while (worker.running !== null || queue.length > 0) {
    startNext()
    if (worker.running === null) break
    timeMs = worker.running.finishAtMs
    completeRunning()
  }

  const firstRenderable = steps.flatMap((step) =>
    step.firstRenderableMs === null ? [] : [step.firstRenderableMs],
  )
  const nearField = steps.flatMap((step) =>
    step.nearFieldCompleteMs === null ? [] : [step.nearFieldCompleteMs],
  )

  return {
    steps,
    generatedWorkMs,
    discardedWorkMs,
    cancelledQueuedWorkMs,
    completedTasks,
    staleCompletions,
    promotions,
    peakRetainedEntries,
    peakRetainedBytes,
    averageFirstRenderableMs: mean(firstRenderable),
    missedFirstRenderableWindows: steps.length - firstRenderable.length,
    averageNearFieldCompleteMs: mean(nearField),
    missedNearFieldWindows: steps.length - nearField.length,
  }
}
