/**
 * Cursor SubagentProvider registration.
 *
 * Wires `start()` to the SDK one-shot driver with apiKey from config.env.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import type { CursorSubagentConfig } from './index.ts'
import { startCursorRun, type CursorRunDeps } from './run.ts'

type Resolved = Required<CursorSubagentConfig>

export type CursorStartRunner = (
  request: SubagentStartRequest,
  deps: CursorRunDeps,
) => Promise<SubagentRun>

export class CursorProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  }
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: Resolved,
    private readonly startRun: CursorStartRunner = startCursorRun,
  ) {}

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    void this.ctx
    const apiKey = this.config.env.CURSOR_API_KEY ?? ''
    return this.startRun(request, {
      apiKey,
      model: this.config.model,
      disposeGraceMs: this.config.disposeGraceMs,
    })
  }
}

/** Register the Cursor provider on `ctx.subagents`. */
export function registerCursorProvider(ctx: Context, config: Resolved): void {
  ctx.subagents.registerProvider(new CursorProvider(config.providerName, ctx, config))
  ctx.logger.info(`dsh-subagent-cursor: registered provider "${config.providerName}"`)
}
