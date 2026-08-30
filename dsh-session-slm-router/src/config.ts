/**
 * Plugin configuration types and resolver for dsh-session-slm-router.
 */

export interface ModelSlot {
  provider: string
  model: string
}

export interface SessionSlmRouterConfig {
  /** 'shadow' (default) or 'off'. S1 prohibits 'on'. */
  mode?: 'shadow' | 'off'
  /** Full shell command for the predictor (no --model / --utterance; those are appended). */
  predictCmd: string
  /** Absolute path to the R1 model JSON. */
  predictModel: string
  /** Sub-process timeout in ms (default 250). */
  timeoutMs?: number
  /** Log file path relative to $HOME/.dsh (default 'slm-shadow/session-slm-shadow.jsonl'). */
  logPath?: string
  /** Slots classified as weak-tier. */
  weakSlots?: ModelSlot[]
  /** Slots classified as strong-tier. */
  strongSlots?: ModelSlot[]
}

export interface ResolvedSessionSlmRouterConfig extends SessionSlmRouterConfig {
  weakSlots: ModelSlot[]
  strongSlots: ModelSlot[]
  timeoutMs: number
}

export const defaultConfig: ResolvedSessionSlmRouterConfig = {
  mode: 'shadow',
  predictCmd: 'python3 /home/shadow/ninjasin-labs/vertical-small-model/scripts/route_predict.py',
  predictModel: '/home/shadow/ninjasin-labs/vertical-small-model/data/eval/routing-v0/model-r1.json',
  timeoutMs: 250,
  logPath: 'slm-shadow/session-slm-shadow.jsonl',
  weakSlots: [
    { provider: 'opencode-go-custom', model: 'ox-alpha-free' },
    { provider: 'opencode-go-custom', model: 'deepseek-v4-flash' },
    { provider: 'opencode', model: 'hy3-free' },
    { provider: 'agnes', model: 'agnes-2.5-flash' },
    { provider: 'commandcode', model: 'deepseek/deepseek-v4-flash' },
    { provider: 'commandcode', model: 'stealth/ox-alpha' },
    { provider: 'commandcode', model: 'minimax/minimax-m2.7-free' },
    { provider: 'commandcode', model: 'minimax/minimax-m3-free' },
    { provider: 'commandcode', model: 'poolside/laguna-s-2.1-free' },
    { provider: 'commandcode-oxalpha', model: 'stealth/ox-alpha' },
    { provider: 'commandcode-free', model: 'minimax/minimax-m2.7-free' },
    { provider: 'commandcode-free', model: 'minimax/minimax-m3-free' },
    { provider: 'commandcode-free', model: 'poolside/laguna-s-2.1-free' },
    { provider: 'teamorouter', model: 'glm-5.3-flash-free' },
    { provider: 'teamorouter', model: 'glm-5.3-flash' },
    { provider: 'teamorouter', model: 'deepseek-v4-flash-free' },
    { provider: 'teamorouter', model: 'deepseek-v4-flash' },
    { provider: 'teamorouter', model: 'deepseek-v4-pro-free' },
    { provider: 'sensenova', model: 'sensenova-6.8-flash-lite' },
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    { provider: 'bailian-chat', model: 'qwen3.8-flash' },
    { provider: 'bailian-chat', model: 'deepseek-v4-flash' },
    { provider: 'bailian-chat', model: 'MiniMax-M2.1' },
    { provider: 'bailian-chat', model: 'MiniMax-M2.5' },
    { provider: 'bailian', model: 'deepseek-v4-flash-0731' },
  ],
  strongSlots: [
    { provider: 'commandcode', model: 'deepseek/deepseek-v4-pro' },
    { provider: 'bailian-chat', model: 'kimi-k2.7-code' },
    { provider: 'bailian-chat', model: 'kimi-k3' },
    { provider: 'bailian-chat', model: 'qwen3-coder-plus' },
    { provider: 'bailian-chat', model: 'qwen3.7-max' },
    { provider: 'bailian-chat', model: 'qwen3.7-max-2026-06-08' },
    { provider: 'bailian-chat', model: 'qwen3.8-max' },
    { provider: 'bailian-chat', model: 'deepseek-v3.1' },
    { provider: 'bailian-chat', model: 'deepseek-v3.2' },
    { provider: 'bailian-chat', model: 'deepseek-v4-pro' },
    { provider: 'bailian-chat', model: 'deepseek-v4-pro-0813' },
    { provider: 'bailian-chat', model: 'deepseek-r1' },
    { provider: 'bailian-chat', model: 'glm-5' },
    { provider: 'bailian-chat', model: 'glm-5.1' },
    { provider: 'bailian-chat', model: 'glm-5.2' },
    { provider: 'bailian-chat', model: 'glm-5.2-fast-preview' },
    { provider: 'bailian-chat', model: 'MiniMax-M2.1' },
    { provider: 'bailian-chat', model: 'MiniMax-M2.5' },
    { provider: 'bailian', model: 'deepseek-v4-pro' },
    { provider: 'bailian', model: 'MiniMax-M2.5' },
    { provider: 'clinepass', model: 'cline-pass/mimo-v2.5' },
    { provider: 'clinepass', model: 'cline-pass/deepseek-v4-pro' },
    { provider: 'clinepass', model: 'cline-pass/minimax-m3' },
    { provider: 'commandcode', model: 'minimax/minimax-m2.7-free' },
    { provider: 'commandcode', model: 'minimax/minimax-m3-free' },
    { provider: 'commandcode-free', model: 'minimax/minimax-m2.7-free' },
    { provider: 'commandcode-free', model: 'minimax/minimax-m3-free' },
  ],
}

export function resolveConfig(config: SessionSlmRouterConfig = {} as SessionSlmRouterConfig): ResolvedSessionSlmRouterConfig {
  return {
    mode: config.mode ?? defaultConfig.mode,
    predictCmd: config.predictCmd ?? defaultConfig.predictCmd,
    predictModel: config.predictModel ?? defaultConfig.predictModel,
    timeoutMs: config.timeoutMs ?? defaultConfig.timeoutMs,
    logPath: config.logPath ?? defaultConfig.logPath,
    weakSlots: config.weakSlots ?? defaultConfig.weakSlots,
    strongSlots: config.strongSlots ?? defaultConfig.strongSlots,
  }
}
