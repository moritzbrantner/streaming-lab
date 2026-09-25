export type SpatialPriorityStrategy = "distance" | "movement" | "view"
export type SpatialBoundaryPolicy = "restart" | "retain"
export type SpatialChunkCoord = readonly [number, number]

export const WORLDGEN_ACTIVE_RADIUS = 3
export const WORLDGEN_CACHE_LIMIT = 96

export const worldgenSquareTraversal: readonly SpatialChunkCoord[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [3, 1],
  [3, 2],
  [3, 3],
  [2, 3],
  [1, 3],
  [0, 3],
  [0, 2],
  [0, 1],
  [0, 0],
]

export type SpatialChunkPlan = {
  key: string
  x: number
  z: number
  distance: number
  resolution: 32 | 16 | 8
  collision: boolean
  viewFacing: boolean
  priority: number
  generationMs: number
}

export type SpatialTraversalStepResult = {
  index: number
  atMs: number
  center: SpatialChunkCoord
  requestedChunks: number
  cacheHits: number
  retainedTasks: number
  queueDepth: number
  firstUsefulMs: number | null
  nearFieldCompleteMs: number | null
}

export type SpatialWorldStreamingResult = {
  steps: SpatialTraversalStepResult[]
  workerLanes: number
  totalGenerationMs: number
  durationMs: number
  workerUtilizationPercent: number
  maxBusyWorkers: number
  requestedChunks: number
  completedChunks: number
  cacheHits: number
  retainedTasks: number
  cancelledQueuedTasks: number
  staleCompletions: number
  wastedGenerationMs: number
  maxQueueDepth: number
  maxCacheSize: number
  averageFirstUsefulMs: number | null
  missedFirstUsefulWindows: number
  averageNearFieldCompleteMs: number | null
  missedNearFieldWindows: number
}

export type SpatialWorldStreamingInput = {
  strategy: SpatialPriorityStrategy
  boundaryPolicy: SpatialBoundaryPolicy
  movementIntervalMs?: number
  activeRadius?: number
  cacheLimit?: number
  route?: readonly SpatialChunkCoord[]
  workerLanes?: number
}

type Vector2 = readonly [number, number]
type CacheEntry = {lastUsedMs: number}
type QueuedTask = SpatialChunkPlan & {revision: number; obsolete: boolean}
type RunningTask = QueuedTask & {startedAtMs: number; finishAtMs: number}

function normalize([x, z]: Vector2): Vector2 {
  const length = Math.hypot(x, z)
  return length === 0 ? [0, 0] : [x / length, z / length]
}

function direction(from: SpatialChunkCoord, to: SpatialChunkCoord): Vector2 {
  return normalize([to[0] - from[0], to[1] - from[1]])
}

function chunkKey(x: number, z: number, resolution: number) {
  return `${x}:${z}:${resolution}`
}

function lodForDistance(distance: number): {resolution: 32 | 16 | 8; collision: boolean} {
  if (distance <= 1) return {resolution: 32, collision: true}
  if (distance === 2) return {resolution: 16, collision: false}
  return {resolution: 8, collision: false}
}

export function worldgenChunkGenerationCostMs(x: number, z: number, resolution: 32 | 16 | 8) {
  const base = resolution === 32 ? 18 : resolution === 16 ? 8 : 3
  const mixed =
    Math.imul(x, 73_856_093) ^
    Math.imul(z, 19_349_663) ^
    Math.imul(resolution, 83_492_791)
  return base + ((mixed >>> 0) % 5)
}

function planPriority(
  distance: number,
  collision: boolean,
  offset: Vector2,
  movement: Vector2,
  view: Vector2,
  strategy: SpatialPriorityStrategy,
) {
  const movementProjection = offset[0] * movement[0] + offset[1] * movement[1]
  const viewProjection = offset[0] * view[0] + offset[1] * view[1]
  const offsetLength = Math.hypot(offset[0], offset[1])
  const viewFacing = offsetLength === 0 || viewProjection / offsetLength >= 0.35
  const nearFieldBias = collision ? -10 : 0

  if (strategy === "distance") {
    return {priority: nearFieldBias + distance, viewFacing}
  }
  if (strategy === "movement") {
    return {priority: nearFieldBias + distance - movementProjection * 0.25, viewFacing}
  }
  return {
    priority:
      nearFieldBias +
      distance -
      movementProjection * 0.1 -
      viewProjection * 0.2 -
      (viewFacing ? 0.8 : 0),
    viewFacing,
  }
}

export function planSpatialView({
  center,
  movement,
  view,
  strategy,
  activeRadius = WORLDGEN_ACTIVE_RADIUS,
}: {
  center: SpatialChunkCoord
  movement: Vector2
  view: Vector2
  strategy: SpatialPriorityStrategy
  activeRadius?: number
}): SpatialChunkPlan[] {
  if (!Number.isInteger(activeRadius) || activeRadius < 1) {
    throw new Error("active radius must be a positive integer")
  }

  const plans: SpatialChunkPlan[] = []
  for (let z = center[1] - activeRadius; z <= center[1] + activeRadius; z += 1) {
    for (let x = center[0] - activeRadius; x <= center[0] + activeRadius; x += 1) {
      const distance = Math.max(Math.abs(x - center[0]), Math.abs(z - center[1]))
      const {resolution, collision} = lodForDistance(distance)
      const {priority, viewFacing} = planPriority(
        distance,
        collision,
        [x - center[0], z - center[1]],
        normalize(movement),
        normalize(view),
        strategy,
      )
      plans.push({
        key: chunkKey(x, z, resolution),
        x,
        z,
        distance,
        resolution,
        collision,
        viewFacing,
        priority,
        generationMs: worldgenChunkGenerationCostMs(x, z, resolution),
      })
    }
  }

  return plans.toSorted(
    (left, right) =>
      left.priority - right.priority ||
      left.x - right.x ||
      left.z - right.z ||
      left.resolution - right.resolution,
  )
}

function mean(values: number[]) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function simulateSpatialWorldStreaming({
  strategy,
  boundaryPolicy,
  movementIntervalMs = 70,
  activeRadius = WORLDGEN_ACTIVE_RADIUS,
  cacheLimit = WORLDGEN_CACHE_LIMIT,
  route = worldgenSquareTraversal,
  workerLanes = 1,
}: SpatialWorldStreamingInput): SpatialWorldStreamingResult {
  if (!Number.isFinite(movementIntervalMs) || movementIntervalMs <= 0) {
    throw new Error("movement interval must be greater than zero")
  }
  if (!Number.isInteger(workerLanes) || workerLanes < 1 || workerLanes > 8) {
    throw new Error("worker lanes must be an integer from 1 to 8")
  }
  if (route.length < 2 || route.some(([x, z]) => !Number.isInteger(x) || !Number.isInteger(z))) {
    throw new Error("spatial traversal requires at least two integer chunk coordinates")
  }

  const desiredCount = (activeRadius * 2 + 1) ** 2
  if (!Number.isInteger(cacheLimit) || cacheLimit < desiredCount) {
    throw new Error("cache limit must fit the active chunk set")
  }

  const initialView = direction(route[0], route[1])
  const initialPlans = planSpatialView({
    center: route[0],
    movement: initialView,
    view: initialView,
    strategy,
    activeRadius,
  })
  const cache = new Map<string, CacheEntry>(
    initialPlans.map((plan) => [plan.key, {lastUsedMs: 0}] as const),
  )

  let timeMs = 0
  let revision = 0
  let currentDesired = new Map(initialPlans.map((plan) => [plan.key, plan] as const))
  let queue: QueuedTask[] = []
  const workers: Array<RunningTask | null> = Array.from({length: workerLanes}, () => null)
  let currentUsefulMissing = new Set<string>()
  let currentNearFieldMissing = new Set<string>()
  let currentStep: SpatialTraversalStepResult | null = null

  const steps: SpatialTraversalStepResult[] = []
  let requestedChunks = 0
  let completedChunks = 0
  let totalGenerationMs = 0
  let maxBusyWorkers = 0
  let cacheHits = 0
  let retainedTasks = 0
  let cancelledQueuedTasks = 0
  let staleCompletions = 0
  let wastedGenerationMs = 0
  let maxQueueDepth = 0
  let maxCacheSize = cache.size

  const sortQueue = () => {
    queue.sort(
      (left, right) =>
        left.priority - right.priority ||
        left.x - right.x ||
        left.z - right.z ||
        left.resolution - right.resolution,
    )
  }

  const busyWorkerCount = () => workers.reduce((total, task) => total + Number(task !== null), 0)

  const updateDepth = () => {
    const busy = busyWorkerCount()
    maxBusyWorkers = Math.max(maxBusyWorkers, busy)
    maxQueueDepth = Math.max(maxQueueDepth, queue.length + busy)
  }

  const evictCache = () => {
    while (cache.size > cacheLimit) {
      const candidates = [...cache.entries()]
        .filter(([key]) => !currentDesired.has(key))
        .toSorted(
          ([leftKey, left], [rightKey, right]) =>
            left.lastUsedMs - right.lastUsedMs || leftKey.localeCompare(rightKey),
        )
      const candidate = candidates[0]
      if (candidate === undefined) {
        throw new Error("cache budget cannot evict the current desired set")
      }
      cache.delete(candidate[0])
    }
    maxCacheSize = Math.max(maxCacheSize, cache.size)
  }

  const startWorkers = () => {
    if (queue.length === 0) return
    sortQueue()
    for (let index = 0; index < workers.length && queue.length > 0; index += 1) {
      if (workers[index] !== null) continue
      const next = queue.shift()
      if (next === undefined) break
      workers[index] = {
        ...next,
        startedAtMs: timeMs,
        finishAtMs: timeMs + next.generationMs,
      }
    }
    updateDepth()
  }

  const completeTask = (completed: RunningTask) => {
    totalGenerationMs += completed.generationMs

    if (completed.obsolete || !currentDesired.has(completed.key)) {
      staleCompletions += 1
      wastedGenerationMs += completed.generationMs
      return
    }

    completedChunks += 1
    cache.set(completed.key, {lastUsedMs: timeMs})
    evictCache()

    if (currentStep !== null) {
      if (currentUsefulMissing.delete(completed.key) && currentStep.firstUsefulMs === null) {
        currentStep.firstUsefulMs = timeMs - currentStep.atMs
      }
      if (currentNearFieldMissing.delete(completed.key) && currentNearFieldMissing.size === 0) {
        currentStep.nearFieldCompleteMs = timeMs - currentStep.atMs
      }
    }
  }

  const nextCompletion = () => {
    let selectedIndex = -1
    let selected: RunningTask | null = null
    for (let index = 0; index < workers.length; index += 1) {
      const task = workers[index]
      if (
        task !== null &&
        (selected === null ||
          task.finishAtMs < selected.finishAtMs ||
          (task.finishAtMs === selected.finishAtMs && index < selectedIndex))
      ) {
        selected = task
        selectedIndex = index
      }
    }
    return {index: selectedIndex, task: selected}
  }

  const advanceTo = (targetMs: number) => {
    startWorkers()
    while (true) {
      const next = nextCompletion()
      if (next.task === null || next.task.finishAtMs > targetMs) break
      timeMs = next.task.finishAtMs
      workers[next.index] = null
      completeTask(next.task)
      startWorkers()
    }
    timeMs = targetMs
  }

  for (let index = 1; index < route.length; index += 1) {
    const eventTimeMs = (index - 1) * movementIntervalMs
    advanceTo(eventTimeMs)

    const previousCenter = route[index - 1]
    const center = route[index]
    const movement = direction(previousCenter, center)
    const nextCenter = route[index + 1] ?? center
    const view = direction(center, nextCenter)
    const plans = planSpatialView({center, movement, view, strategy, activeRadius})
    const nextDesired = new Map(plans.map((plan) => [plan.key, plan] as const))
    const newlyDesired = plans.filter((plan) => !currentDesired.has(plan.key))

    revision += 1
    let stepCacheHits = 0
    for (const plan of newlyDesired) {
      const cached = cache.get(plan.key)
      if (cached !== undefined) {
        stepCacheHits += 1
        cached.lastUsedMs = timeMs
      }
    }
    for (const plan of plans) {
      const cached = cache.get(plan.key)
      if (cached !== undefined) cached.lastUsedMs = timeMs
    }
    cacheHits += stepCacheHits

    let retainedThisStep = 0
    if (boundaryPolicy === "restart") {
      cancelledQueuedTasks += queue.length
      queue = []
      for (const task of workers) {
        if (task !== null) task.obsolete = true
      }
    } else {
      queue = queue.flatMap((task) => {
        const nextPlan = nextDesired.get(task.key)
        if (nextPlan === undefined || task.obsolete) {
          cancelledQueuedTasks += 1
          return []
        }
        retainedThisStep += 1
        return [{...task, ...nextPlan}]
      })
      for (const task of workers) {
        if (task === null || task.obsolete) continue
        if (nextDesired.has(task.key)) {
          retainedThisStep += 1
        } else {
          task.obsolete = true
        }
      }
    }

    currentDesired = nextDesired
    const outstanding = new Set(queue.filter((task) => !task.obsolete).map((task) => task.key))
    for (const task of workers) {
      if (task !== null && !task.obsolete) outstanding.add(task.key)
    }

    let requestedThisStep = 0
    for (const plan of plans) {
      if (cache.has(plan.key) || outstanding.has(plan.key)) continue
      queue.push({...plan, revision, obsolete: false})
      outstanding.add(plan.key)
      requestedChunks += 1
      requestedThisStep += 1
    }
    sortQueue()

    retainedTasks += retainedThisStep
    currentUsefulMissing = new Set(
      plans
        .filter((plan) => !cache.has(plan.key) && (plan.collision || plan.viewFacing))
        .map((plan) => plan.key),
    )
    currentNearFieldMissing = new Set(
      plans.filter((plan) => !cache.has(plan.key) && plan.collision).map((plan) => plan.key),
    )

    currentStep = {
      index,
      atMs: timeMs,
      center,
      requestedChunks: requestedThisStep,
      cacheHits: stepCacheHits,
      retainedTasks: retainedThisStep,
      queueDepth: queue.length + busyWorkerCount(),
      firstUsefulMs: currentUsefulMissing.size === 0 ? 0 : null,
      nearFieldCompleteMs: currentNearFieldMissing.size === 0 ? 0 : null,
    }
    steps.push(currentStep)
    updateDepth()
    startWorkers()
  }

  while (queue.length > 0 || busyWorkerCount() > 0) {
    startWorkers()
    const next = nextCompletion()
    if (next.task === null) break
    timeMs = next.task.finishAtMs
    workers[next.index] = null
    completeTask(next.task)
  }

  const firstUseful = steps.flatMap((step) => (step.firstUsefulMs === null ? [] : [step.firstUsefulMs]))
  const nearField = steps.flatMap((step) =>
    step.nearFieldCompleteMs === null ? [] : [step.nearFieldCompleteMs],
  )

  return {
    steps,
    workerLanes,
    totalGenerationMs,
    durationMs: timeMs,
    workerUtilizationPercent:
      timeMs === 0 ? 0 : totalGenerationMs / (timeMs * workerLanes) * 100,
    maxBusyWorkers,
    requestedChunks,
    completedChunks,
    cacheHits,
    retainedTasks,
    cancelledQueuedTasks,
    staleCompletions,
    wastedGenerationMs,
    maxQueueDepth,
    maxCacheSize,
    averageFirstUsefulMs: mean(firstUseful),
    missedFirstUsefulWindows: steps.length - firstUseful.length,
    averageNearFieldCompleteMs: mean(nearField),
    missedNearFieldWindows: steps.length - nearField.length,
  }
}
