/**
 * dsh-context-compass — smoke test runner.
 *
 * Drives the built lib/ with stub services: projection fold over synthetic
 * events, the shared assess() core, the /compass command handler, and the
 * context_compass tool execute. Run after `npm run build`.
 *
 *   npm run build && npm run smoke
 *
 * The checks live in scripts/tests/<domain>.mjs. The call order below is the
 * EXACT order of `await check(...)` blocks in the former monolithic
 * scripts/smoke.mjs — several suites depend on earlier side effects (overview
 * cache state, module-level stubs, Date.now/setInterval patches), so do not
 * reorder. Where a domain's checks were interleaved with another domain's in
 * the original file, that domain exports extra phase functions (e.g.
 * projection.runCostMath, command.runTextBuilder) to preserve the sequence.
 */
import { results } from './tests/helpers.mjs'
import * as util from './tests/util.mjs'
import * as projection from './tests/projection.mjs'
import * as usage from './tests/usage.mjs'
import * as assess from './tests/assess.mjs'
import * as pricing from './tests/pricing.mjs'
import * as command from './tests/command.mjs'
import * as tool from './tests/tool.mjs'
import * as overview from './tests/overview.mjs'
import * as s2 from './tests/s2.mjs'
import * as r1 from './tests/r1.mjs'
import * as s3 from './tests/s3.mjs'
import * as c1 from './tests/c1.mjs'

await util.run()
await projection.run()
await usage.run() // sandwiched inside the projection block in the monolith (L270)
await projection.runCostMath()
await assess.run()
await pricing.run() // includes the pricing-adjacent money-field + CNY remainingNote checks (L774/L791)
await command.run()
await tool.run()
await command.runTextBuilder() // buildCommandText text-builder trio sat after the tool block (L1023-1087)
await overview.run()
await s2.run()
await r1.run() // R1 ran between S2 and S3 in the monolith
await s3.run()
await c1.run()

if (results.failures > 0) {
  console.error(`\n${results.failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall smoke checks passed')
