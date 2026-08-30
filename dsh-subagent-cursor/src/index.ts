/**
 * dsh-subagent-cursor — Cursor product subagent for DeepSeek Harness.
 *
 * Registers a `ctx.subagents` provider (default name `cursor`). Each run is a
 * one-shot local `@cursor/sdk` query in the parent session cwd.
 *
 * Bundle: host plane Profile Bundle — same family as official Claude Code /
 * Codex providers. Model-facing tools are separate `dsh-tool-subagent` rows.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerCursorProvider } from './provider.ts'

/** Plugin config; every field optional with a sane default. */
export interface CursorSubagentConfig {
  /** Registry name on `ctx.subagents` (default `cursor`). */
  providerName?: string
  /** Cursor model id passed to the SDK (default pinned in resolveConfig). */
  model?: string
  /**
   * Explicit child/SDK environment layered over a credential-scrubbed parent
   * env. Supply `CURSOR_API_KEY` here.
   */
  env?: Record<string, string>
  /** Positive grace (ms) for teardown waits (default 3000). */
  disposeGraceMs?: number
}

export const name = 'dsh-subagent-cursor'
/** Subprocess peer reserved for Phase 0 process ownership; SDK path may not need it initially. */
export const inject = ['subagents']

export const defaultConfig = {
  providerName: 'cursor',
  model: 'composer-2.5',
  env: {},
  disposeGraceMs: 3000,
} satisfies Required<CursorSubagentConfig>

export function resolveConfig(config: CursorSubagentConfig = {}): Required<CursorSubagentConfig> {
  return {
    providerName: config.providerName ?? defaultConfig.providerName,
    model: config.model ?? defaultConfig.model,
    env: config.env ?? defaultConfig.env,
    disposeGraceMs: config.disposeGraceMs ?? defaultConfig.disposeGraceMs,
  }
}

export function apply(ctx: Context, config: CursorSubagentConfig = {}): void {
  const resolved = resolveConfig(config)
  if (!Number.isFinite(resolved.disposeGraceMs) || resolved.disposeGraceMs <= 0) {
    throw new Error('dsh-subagent-cursor: disposeGraceMs must be a positive finite number')
  }
  if (resolved.providerName.trim() === '') {
    throw new Error('dsh-subagent-cursor: providerName must be non-empty')
  }
  registerCursorProvider(ctx, resolved)
}

export default {
  name,
  inject,
  apply,
}
