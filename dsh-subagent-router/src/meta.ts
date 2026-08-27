/**
 * dsh-subagent-router — model metadata derivation.
 *
 * ROADMAP 1c: annotate the `subagent_models` catalog with cost tier, speed,
 * strength, specialty, and (where known) context window — the groundwork for
 * the recommend tool (2a). Zero external data: every field is derived from the
 * model id's naming signals plus a small built-in map of well-known models.
 * Precise pricing / context figures are out of scope here and belong to 3c
 * (context-compass integration).
 *
 * Honesty rule: fields we cannot infer are OMITTED rather than guessed. A
 * model id outside the known map simply lacks `contextWindow`.
 */

/** Cost tier. */
export type CostTier = 'high' | 'mid' | 'low'

/** Speed tier. */
export type SpeedTier = 'fast' | 'normal' | 'slow'

/** Strength tier (mirrors the auto-selection naming score). */
export type StrengthTier = 'strong' | 'mid' | 'light'

/** A specialty the model id advertises. */
export type Specialty = 'code' | 'reasoning' | 'vision' | 'math'

/** Structured metadata for one model id. */
export interface ModelMeta {
  /** Cost tier derived from naming (strong → high, light → low). */
  cost: CostTier
  /** Speed tier derived from naming (light → fast, reasoning → slow). */
  speed: SpeedTier
  /** Strength tier derived from naming. */
  strength: StrengthTier
  /** Specialties the id advertises (possibly empty). */
  specialty: Specialty[]
  /** Known context window label; omitted when the id is not in the known map. */
  contextWindow?: string
}

/** Naming signals for a strong / reasoning model. */
const STRONG = /\b(pro|max|reason|think|ultra|code|turbo|large|deep)\b/i

/** Naming signals for a cheap / fast model. */
const LIGHT = /\b(flash|mini|lite|fast|small|quick|nano|light)\b/i

/** Reasoning-heavy signals — slow even when also strong. */
const REASONING = /\b(reason|think|o1|o3|r1)\b/i

/** Specialty signals. */
const CODE = /\b(code|coder|dev)\b/i
const VISION = /\b(vision|vl|omni|pixtral|gpt-4o|gemini)\b/i
const MATH = /\b(math|mathematica)\b/i

/**
 * Well-known context-window labels. Kept intentionally small and only for
 * unambiguous ids; a model not listed omits the field (never guessed).
 */
const CONTEXT_WINDOW: Readonly<Record<string, string>> = {
  'deepseek-v4-pro': '128k',
  'deepseek-v4-flash': '128k',
  'deepseek-r1': '64k',
  'gpt-5.2': '400k',
  'gpt-5.2-mini': '400k',
  'gpt-5.2-nano': '400k',
  'claude-sonnet-4-5': '200k',
  'claude-haiku-4-5': '200k',
  'claude-opus-4-6': '200k',
  'gemini-3.0-pro': '1m',
  'gemini-3.0-flash': '1m',
}

/** Derive the structured metadata for one model id (never throws). */
export function modelMeta(id: string): ModelMeta {
  const strong = STRONG.test(id)
  const light = LIGHT.test(id)
  const reasoning = REASONING.test(id)

  const strength: StrengthTier = strong ? 'strong' : light ? 'light' : 'mid'
  const cost: CostTier = strong ? 'high' : light ? 'low' : 'mid'
  const speed: SpeedTier = light ? 'fast' : reasoning ? 'slow' : 'normal'

  const specialty: Specialty[] = []
  if (CODE.test(id)) specialty.push('code')
  if (reasoning) specialty.push('reasoning')
  if (VISION.test(id)) specialty.push('vision')
  if (MATH.test(id)) specialty.push('math')

  const contextWindow = CONTEXT_WINDOW[id]
  return {
    cost,
    speed,
    strength,
    specialty,
    ...contextWindow !== undefined ? { contextWindow } : {},
  }
}
