/**
 * Task prompt wrapper: append the soft-contract summary/status/body footer.
 */

export const TASK_RESULT_FOOTER = `
---
When finished, reply in exactly this shape (no other wrapping):
<summary>one plain-language sentence</summary>
<status>ok|partial|blocked</status>
<body>
evidence and details (paths, commands, what was not done)
</body>
If you could not complete the work, use status partial or blocked — never claim ok without evidence.
`.trimEnd()

/** Append the stable result-format footer to the user's task text. */
export function wrapTaskPrompt(userText: string): string {
  return `${userText.trimEnd()}\n${TASK_RESULT_FOOTER}`
}
