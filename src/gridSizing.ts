export interface ChartGridSizes { rows: number[], columns: number[] }

export function gridDimension (value: number | undefined, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(64, Math.floor(value))) : fallback
}

export function gridWeights (weights: number[] | undefined, count: number): number[] {
  if (!Array.isArray(weights) || weights.length !== count || weights.some(value => !Number.isFinite(value) || value <= 0)) return Array(count).fill(1 / count)
  const max = Math.max(...weights)
  const scaled = weights.map(weight => weight / max)
  const total = scaled.reduce((sum, value) => sum + value, 0)
  return scaled.map(weight => weight / total)
}

/** Move only the adjacent pair. Tiny containers degrade to equal halves of that pair. */
export function resizeGridPair (weights: number[], boundary: number, deltaPx: number, availablePx: number, minPx: number): number[] {
  const next = [...weights]
  if (boundary < 0 || boundary + 1 >= weights.length || !Number.isFinite(deltaPx) || !(availablePx > 0)) return next
  const sum = weights[boundary] + weights[boundary + 1]
  const minimum = Math.min(sum / 2, Math.max(0, minPx) / availablePx)
  next[boundary] = Math.max(minimum, Math.min(sum - minimum, weights[boundary] + deltaPx / availablePx))
  next[boundary + 1] = sum - next[boundary]
  return next
}
