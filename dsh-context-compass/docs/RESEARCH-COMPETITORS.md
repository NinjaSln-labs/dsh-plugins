# dsh-context-compass 竞品与业界调研：上下文罗盘 / 上下文占用指示器

> 产出：竞品调研子代理（delegated-research，2026-08）
> 背景：本插件在 IDE/Web 界面显示「绿/蓝/黄/红」四档徽章 + 窗口占用百分比 + 缓存命中 + 计费预期，点击展开浮层，并提供 `/compass` 命令与 `context_compass` 模型自查工具——帮助用户决策「继续当前会话 vs 新开会话」。
> 本文调研主流 AI 编码工具/LLM 平台对「上下文占用 / 上下文罗盘」的现成做法，聚焦可落地的观察：**阈值如何分级、压缩 UI 文案、新会话建议的触发条件**。
> 相关文档：`DESIGN.md`（插件设计）、`OPTIMIZATION-RESEARCH.md`（0.5.x 优化方向，已引用本文件）。

---

## 0. 结论速览（TL;DR）

- **没有任何一家主流工具把你的诉求完整做齐。** 「四档健康分级 + 占用百分比 + 缓存命中 + 计费预期 + 建议新会话」是一个**尚未被填满的差异位**。各家都只覆盖了其中 1–3 项，且几乎没有一家对「继续 vs 新开」给出可量化的建议，基本靠用户经验。
- **硬性阈值高度趋同**：多数工具在「上下文占用的 **80%–90%**」触发自动压缩 / 报警，**95%** 附近强制阻塞等待。「达到 100% 才处理」是常见反模式，权威参考明确建议在 **刚过 50–60%、远离上限** 时就主动 compact 保持质量（context rot / pre-rot 概念）。
- **竞品最大的空白 = 压缩计数/压缩比例 与 成本预期**：Claude Code 官方明确「无法看到压缩次数」是痛点；Codex 用户做「死亡螺旋」上报；Copilot 官档给出 `/context` 分类明细。**这些正是本插件已做的浮层维度，属于差异化领先点。**
- **「建议新会话」几乎只有概念、没有产品化**：Claude 官方博客给出「新任务 → 新会话（/clear）」的规则，Cursor/Copilot 只在论坛层面表达需求；OpenCode 生态则用「handoff 工具」外部弥补。**本插件的二维判定（成本 + 切换成本）是业界唯一系统化实现。**
- **原生「常驻可见占用 %」是强需求**：Cursor 把占用 % 改成 hover-only 后遭到论坛反弹，用户明确说「没有它我就不知道何时该开新会话」。这验证了本插件「常驻 badge」的方向。
- **无障碍基线明确**：进度条不能只靠颜色（设计系统规范），必须「颜色 + 文字 + 音量/形状」多重编码，相邻色段对比度 ≥ 3:1。本插件的无颜色词 label + aria 做法符合规范。

---

## 1. 各家横向对比表

> 标注「—」表示没有可靠来源对应该项。来源 URL 见 §7 附注，正文按厂商给关键来源。

| 维度 | **Cursor** | **Claude Code** | **Copilot (CLI/agent)** | **OpenAI Codex** | **Windsurf** | **Cline** | **Roo Code** | **OpenAI ChatGPT** | **JetBrains AI** |
|---|---|---|---|---|---|---|---|---|---|
| **占用 % / token 显示** | 常驻底部状态条 %（3.11.13 起改 hover-only） | 默认不显；statusline 可挂 `context_window.used_percentage`；`/context` 命令 | CLI: `/context` 分类明细（System/Tools/MCP/Messages/Free/Buffer %） | TUI 状态行常驻 % + `/status`；CLI `/usage` | 无固定 % 指标（RAG 检索式） | 上下文进度条/token 数 | `ContextWindowProgress` 条（当前占用+保留+可用+原始 token） | 无占用条，达上限弹提示 | 无占用条 |
| **自动压缩/精简触发阈值** | 满时自动 summarization（~近 100%） | 窗口将满时 autocompact（后台自动） | **~80% 开始后台压缩，95% 强制暂停等待** | **90% 硬上限**（可下调不可上调）；建议 60% 主动 | RAG 相关检索，非按 % 精简 | **90%** 触发，压缩后目标 **70%** | 用户可配阈值滑块（默认 100%） | 无（直接硬切） | — |
| **压缩结果 UI/文案** | 自动 "summarizing context"；/summarize 手动 | /compact 手动；autocompact 摘要替换历史 | /compact 手动；保留压缩时新增消息 | /compact 手动（可带指令）；加密 blob 或本地 _summary | 有损 summarization，保留最近工具调用原始 | 显示总结 tool call + 成本；可展开 | "正在压缩上下文..." 进度；前后 token 计数 + 成本 + 可展开摘要 | 「已达对话长度上限，请新开」 | — |
| **压缩次数/比例可视化** | ❌ 无 | ❌ 无（社区痛点，issue #22220 类） | ❌ 无（/context 看是否发生过） | ❌ 无（用户自建 telemetry） | ❌ | ❌ | 每次压缩显示前后计数 | ❌ | ❌ |
| **成本/计费预期** | 有限度（用量池） | 官方博客讲透 cache/成本；`/usage` 命令 | `/usage` 报告 | `codex exec --json` usage | — | 压缩调用显示成本 | 压缩调用显示成本 | — | — |
| **建议新会话机制** | 论坛需求（无系统实现） | 官方规则「新任务→/clear」；（博客） | — | 压缩/归档/恢复生命周期 | 手动新 chat | 手动 | 手动 | 硬顶时提醒新开 | 手动新 chat |
| **checkpoint / 恢复** | — | /rewind、/clear、/resume、/fork、/branch | 每次压缩生成 checkpoint 文件；`/session checkpoints` | session lifecycle archive/resume/fork | — | Checkpoints（快照回放） | 检查点（时间线） | 会话列表 | — |
| **健康分级色彩** | 单色占用条填充 | 无分级 | 无分级 | 状态条 % | — | 填充条 | 多段条（占用/保留/可用） | — | — |
| **描述「为什么 % 高」** | 3.7 Context Usage Report（系统提示/工具/规则/skill/读文件拆分） | /context 展示已加载项 | /context 分类 | — | Context Engine 检索 | — | — | — | — |

---

## 2. 各家功能细读

### 2.1 Cursor

**显示什么 / 怎么放。**
Cursor 的「上下文占用指示」体现在 Chat 的模型名附近：一个随对话填充的彩色占用条 + 常驻百分比。它与「模型名 + 用量池」并列出现在输入框下方状态区。官方 FAQ 确认 Agent 模式下对话上下文按模型窗口计算。

**紫色进度条的语义。**
Cursor 的占用条并非「纯模型 token」，而是**把 System Prompt、工具定义、规则、Skills、读过的文件、对话历史全都计入**窗口占用——这解释了为什么用户反映「新开一个空对话也立刻 100%」（全局 Skills 会被加载进上下文）。这本质上和本插件「系统提示 + 工具 + 规则是一次性底座、会话内容动态增长」的窗口占用口径一致。

关键佐证（官方/论坛）：
- **Cursor 3.7 引入「Context Usage Report」**——在 Canvas 里展示 Agent 输入到底由什么构成，细分到 system prompt / tool definitions / rules / skills / 读过的文件，并带 "Debug with Agent" 按钮建议在新对话里降低上下文。这是「上下文占用可视化 + 建议新会话」两件事的官方最小实现。
- **论坛「Why is the latest version no longer displaying context window usage」** —— 大量用户反馈：占用 % 从常驻状态条改到 hover-only 是**可用性倒退**，并明确说「没有它，我不知道什么时候该切到新会话」。

**压缩 compaction 的 UI 处理与文案。**
- Cursor 在上下文接近占满时**自动对旧消息做 summarization**（它叫 compact/summarize），把长历史压成摘要继续对话；`/summarize` 是手动触发命令。压缩后旧内容消失、保留一份摘要。
- 空对话也 100% 的 bug 上报里，Cursor 工作人员确认「全局 skills/rules/MCP 定义会在开新对话时全部载入」，并把它和「持续触发 summarization」联系起来——即**压缩轮次过多**本身就会损失语境，和 Codex「死亡螺旋」同类风险。
- 由于压缩对用户不可见细节（到底压了什么、压了几次），论坛里反复有人要「更清晰的使用统计」（`/usage` 类诉求）。

**阈值分级。**
没有公开的「绿→红」四档阈值表。压缩在「接近占满」触发；用户观察到的 UI 是「x% context used」文本 + 占用条填充度 + 满后 summarization。分级主要靠用户目测占用条。

---

### 2.2 Claude Code

**context window 显示。**
- **默认 UI 并不常驻显示 context %**。这是关键差异点：Claude Code 默认终端界面没有内置的占用百分比，只在你按需查询时可见。
- 官方文档（Statusline）提供 `context_window.used_percentage` / `context_window.remaining_percentage` / `context_window.total_input_tokens` / `total_output_tokens` / `current_usage` 给**用户自建的状态行脚本**读取——即数据是有的，但展示需要用户自己接。
- `/context` 命令显示当前对话上下文里**已经加载了什么**（CLAUDE.md、MCP 工具定义等），用于「该砍掉哪些」。官方博客建议「新会话里跑一次 /context 看看基线占了多少」。
- 社区（anthropics/claude-code issue #39415「Add visible context window usage indicator」、#38971「show context window usage percentage」）持续请求**原生常驻占用百分比**——官方至今未做。**这是本插件最直接对标/超越的空白。**

**/compact 压缩机制。**
- `/compact`：让模型把当前会话总结成一段摘要，**替换对话历史**以释放空间；可带参数 `compact_prompt` 或交互式指令（如 `/compact focus on the auth refactor`）来引导摘要重点。
- **autocompact**：上下文窗口将满时自动触发。官方文档把达到窗口边缘的自动总结称为 compaction。
- 关键官方认知（session management 博客）：
  - **bad compact 的场景**：模型在「最不聪明」的时刻被要求压「它无法预判方向」的会话，容易丢关键信息；1M 窗口给了更多**主动** `/compact` 的时间。
  - **`/compact` vs `/clear` 的取舍**：compact 有损但省事；clear 写清楚要什么、重新开始，上下文更干净但更费事。
  - **`/rewind`**：双按 Esc 回退到任意历史消息重新发，只切掉末尾，比 compact 省 cache。

**压缩后提示。**
压缩后 CLI 会提示上下文已压缩/可以继续，历史被摘要替代。官方反复强调「压缩是 lossy 的」，并建议在新任务时用 `/clear` 而不是只靠 compact。

**成本与「新会话」官方建议（核心参考）。**
- **当任务相关、上下文仍有用时 → 继续（Continue）**；**当会话被陈旧调试/探索信息塞满但任务仍在进行 → `/compact <hint>`**；**当要开始一个真正的新任务 → `/clear`（零 rot，你控制带过去什么）**。
- **`/model` / `/effort` / fast mode / `/compact` / 时间超时**都会让 prompt cache 失效导致重新全量 prefill（成本骤升）——官方给出一整套「何时切、何时新开」的经济学判据（见 §5.3）。这正是本插件「经济维度 + 计费预期」的官方背书。

---

### 2.3 GitHub Copilot

**Chat 的上下文指示。**
- **桌面/IDE Chat**（VS Code、Visual Studio、JetBrains）**没有可见的 context % / token 占用指示**。Copilot「学习中心」文档只描述 Copilot 如何**来源**上下文（打开的文件、光标、相关文件、对话历史、工作区），答疑里也只说「响应里能看到引用了哪些文件」——没有占用百分比。桌面/IDE 端只在你主动清空对话或开新会话时重置。
- **Copilot CLI / Agent 模式**是唯一提供上下文查看的地方：
  - `/context`：可视化当前窗口占用，首行显示「活跃模型 + 已用 token / 窗口容量」，随后按 **System Prompt / Custom Instructions / System Tools / MCP Tools / Messages / Free Space / Buffer** 分类给出 token 与百分比——这是各家里最清晰的「占用结构拆分」，与本插件浮层的「占用条 + 窗口 + 轮次/消息数」思路一致。
  - 提示使用 `/context` 的时机 = 本插件「继续 vs 新开」的触发场景：长会话想知道剩多少、怀疑模型忘了开头、想确认压缩是否即将发生。

**公开阈值（业务内部配置）。**
- 对话达 **~80%** 窗口容量 → 后台开始自动压缩（留 20% 缓冲让工具调用继续跑）。
- 若在压缩完成前涨到 **~95%** → 暂停等待压缩完成。
- `/compact` 手动触发；**每次压缩生成一个 checkpoint**（保存压缩摘要为带编号标题文件），`/session checkpoints` 查看、可从此恢复——这是「新会话安全交接」的官方内建机制。

**压缩后提示。**
官方文档明确说明压缩「失去细节」：「如果你需要更早对话里一个非常具体的细节，压缩后它可能不在了。」并提供检查点用于追溯/恢复。

---

### 2.4 OpenAI Codex（CLI / Desktop App）

**上下文进度 / 状态。**
- TUI 状态行**常驻显示 context 使用百分比**；`/status` 可查。`codex exec --json` 在 `turn.completed` 事件里上报 `input_tokens / cached_input_tokens / output_tokens / reasoning_output_tokens`（可用于 CI）。
- **现状**：Codex Desktop App 的常驻 context/token 指示在某个版本被移除（openai/codex #23591「Reimplement visible context/token usage indicator」、#23794「no longer shows visible indicator」）——用户抗议并要求恢复。**再次印证「常驻可见占用」是硬需求。**
- 社区已有第三方工具（`codex-context-used-meter`）专门补回占用指示。

**自动压缩机制（架构层）。**
- **双触发点**：pre-turn（下一次发送前检查是否超阈值，超则先压）与 mid-turn（长工具链内部）。
- **OpenAI 路径**：POST `/responses/compact`，服务器把会话压成 **AES 加密的不透明 blob**，客户端不可见、不可篡改；**本地路径**（第三方 provider）：追加一个 summarization prompt 让模型产出 `_summary` 用户消息。
- 压缩后重建上下文 = **一份摘要 + 最近 ~20K tokens 的用户消息**；其余全丢弃。多次压缩时正确「只保留最新摘要」，旧摘要不累积。
- `model_auto_compact_token_limit` 可下调、**不可高于窗口 90%**（硬 clamp，v0.100 引入，避免溢出后端报错）。

**阈值分级（业务值）。**
- 默认自动压缩约在 **窗口 90–95%** 触发；官方周边强烈建议**主动在 ~60% 就 `/compact`**（在 60% 时留足空间产出高质量摘要，而非 95% 压力下压缩）。
- 社区健康指标（v0.130 前后）：状态条 **>80%** 视为「逼近压缩区」；90%+ 是硬顶。

**压缩后 UI/文案与风险机制。**
- `/compact` 手动命令自 v0.117 支持**排队带指令的摘要**（`/compact Focus on the auth refactor...`）。
- `/compact` 也作为「手动主动压缩」的建议被反复强调，避免等自动触发而卡在难堪的中间 turn。
- **已知故障模式「死亡螺旋」**（v0.112）：高 reasoning effort + 压缩逻辑反馈循环 → 反复压到 12% 剩余、读几个文件又触发、无限循环、烧掉 80% 用量且没改代码。→ 印证「压缩次数/比例需要被看见」，否则用户察觉不到螺旋。

**新会话建议 / session 生命周期。**
- 生态文档给出 **archive / resume / fork / compact** 四个会话生命周期操作，「用 checkpoint 恢复」被推荐为长会话的保险丝。没有「系统自动建议你新开」，靠用户在 `/status` 看 % 自己判断。

---

### 2.5 Windsurf

**上下文指示现状。**
Windsurf 走的是**和 Cursor/Claude/Codex 不同的路线**：它的「Context Engine」是 RAG 检索式索引，**不靠「窗口占用 %」这一单一信号**来管理上下文，而是尽量让检索到的「相关代码」进上下文。因此**没有常驻的占用百分比指示器**（这正是它长期被用户抱怨的原因之一——「为什么 Cascade 忘记/上下文不够、何时该开新对话」缺乏可见信号）。

**如何组装上下文（官方/可靠转载）。**
官方文档（Context Awareness）描述：Windsurf 为每次交互**按管线组装上下文**——加载 rules（全局→项目 `.windsurfrules`）→ 检索 memories → 编辑器活跃状态（当前文件/光标/选区）→ 处理 @-命令 → 追加 flow context（近期编辑/终端输出/导航）→ **应用模型约束「裁剪到适配模型窗口」**。模型窗口大小决定它能塞多少，超了会被裁剪（有报道称私有/第三模型窗口字段设置不当会静默截断）。
- Windsurf 官方有 `@web` / `@docs` 显式引用，以及跨会话持久化的 **Memories & Rules**（global/workspace/system 三级）——本质上用「memories 持久化」缓解「新会话丢失上下文」。

**新会话建议。**
无系统建议；用户手动开新 Cascade chat，靠 Memories 延续语境。Windsurf 文档建议「选择更大窗口的模型做复杂重构」。

---

### 2.6 Cline（VS Code 生态，前身 Claude Dev）

**上下文指示。**
- Cline 在对话里有上下文窗口相关 UI（token 占用估算 + 状态），并有 `context-window` 概念文档。
- 源码里暴露具体压缩参数（`compaction-shared.ts`）：
  - `COMPACTION_TRIGGER_RATIO = 0.9` —— 转录文本占用可用输入预算的 **90%** 触发压缩。
  - `DEFAULT_TARGET_RATIO = 0.7` —— 压缩后目标占用 **70%**。
  - `DEFAULT_PRESERVE_RECENT_TOKENS = 20_000` —— 保留最近 **20K** tokens 不压缩。
  - `DEFAULT_MAX_INPUT_TOKENS = 128_000` —— 无输入上限时的默认最大输入。
  - `CONTEXT_WINDOW_INPUT_RATIO = 0.9` —— 只报 contextWindow 时按 90% 估算可用输入。
  - 工具输出/文件内容压缩上限 2000 字符。

**Auto Compact（官方文档）。**
- 对话接近窗口上限时，Cline 自动总结：**创建一个综合摘要 → 保留技术细节/代码改动/决策 → 用摘要替换历史 → 原地继续**。
- UI 上会**显示一个 summarization tool call**，并像任何 API 调用一样展示成本——这是「压缩这一动作本身有成本」的少数显式 UI。
- 关键价值主张：**以前是硬截断丢消息，现在用摘要保住决策**；依赖「结构化任务清单」跨多窗口维持进度。
- 社区反复反馈 auto-compact 在 160K 附近压缩丢关键上下文/重做已完成工作（issue #5790）、自动裁剪不工作（#5856）——压缩质量与触发时机仍是痛点。

**Checkpoints。**
Cline 3.x 内置 Checkpoints（快照/回放），可把项目/对话回退到任意阶段——「新会话/继续」的安全网，也是本插件「切换成本（checkpoint 存在性）」检查项的对象。

---

### 2.7 Roo Code（Cline 的 fork/竞品）

**上下文指示（最接近本插件的存在）。**
- **`ContextWindowProgress` 条**：直观展示 token 分布——**当前占用、为 AI 输出保留的空间、可用空间、原始 token 数量**。这是竞品里与本插件浮层占用条最像的实现。
- 任务标题、上下文栏也显示当前压缩状态；压缩进行时显示进度指示（"正在压缩上下文..."）。

**阈值与触发。**
- **智能上下文压缩默认启用**，可在「上下文」设置里配置：**自动触发开关 + 压缩阈值百分比滑块（默认 100%）**、自定义压缩 prompt、压缩模型（与当前对话同一模型/provider）。
- 手动「压缩上下文」按钮位于任务顶部上下文栏右侧，带解释性 tooltip（全语言）。
- **错误自动恢复**：检测到上下文窗口错误（OpenAI/Anthropic/Cerebras 等）时自动把上下文截断 **25%** 并重试，无需手动重启——「上下文过载」的兜底。

**压缩 UI / 文案（审计跟踪）。**
压缩发生时展示：
- 压缩前后的**上下文 token 计数**
- 压缩调用的**成本**
- **可展开的摘要**详述被压缩了什么（`ContextCondenseRow`）
- 压缩活动时聊天界面有视觉进度指示器。

Roo 官方强调**压缩模型必须与当前一致**（用别的模型压质量差、格式转换出错）；并提供 `customSupportPrompts.CONDENSE` 覆盖。

**上下文窗口管理（技术实现）。**
- 默认预留上下文窗口 **30%**（20% 留给模型输出 + 10% 安全缓冲），**70%** 给对话历史；预留比例可按模型覆盖。
- token 计数：优先原生 API（如 Anthropic），失败回退 tiktoken；文本按词估算计入标点/换行，**图片保守按 300 token/张**，系统提示计结构性额外开销。

---

### 2.8 OpenAI ChatGPT / OpenAI 生态（非编码 CLI）

**上下文进度 / 新会话建议。**
- **没有常驻的占用百分比条。**
- 达到对话长度上限时，ChatGPT 弹出：「**This conversation is too long, but you can continue by starting a new chat**」/ 中文化「**已达对话长度上限，请新开对话**」——这是「新会话建议」最简单直接的形态，但**只在上限被命中后才出现（reactive）**，本插件是在达到上限**之前**主动提示（proactive）。
- OpenAI 生态的 `compact` / `restack`（Codex CLI）有 compression 概念，但 ChatGPT web 端本身不做自动压缩，硬顶即提示新开。

---

### 2.9 JetBrains AI Assistant

**上下文指示。**
没有围绕 context 占用 % 的产品级指示器。用户通过「新开 AI Chat」「Clear Chat」重置换上下文。官方/社区可见的只是 AI Chat 界面对话历史、模型选择；新生成的 ACP 生态 issue 甚至还在请求「emit usage_update 让 ACP 客户端（JetBrains）能显示 context 使用量」——说明**JetBrains 侧缺席是最彻底的**，连 ACP 协议的 usage_update 都还没铺到上下文占用。本插件的「常驻占用 + 成本」在 JetBrains 生态是空白机会。

---

## 3. 上下文健康指示的 UX 最佳实践

> 面向本插件「占用 % 徽章 + 浮层」形态的已落地规范与通用 UX 共识。

### 3.1 进度条 vs 百分比 vs 颜色分级

- **进度条是「tone」分级的天然载体**：设计系统（Cimpress、GitHub Primer、ActiveCampaign 等）都把进度条做成「base / success / warning / critical」几档，每档配合**文字 label**。Cimpress 示例即 `<ProgressBar tone="warning" label="Warning" value={80}/>`——**同一个值 80% 可以带不同 tone 表示语义**，这与本插件「绿/蓝/黄/红四档 + 百分比」完全同构。
- **百分比 vs 进度条**：
  - 数字百分比**精确但冷**，适合「本插件 /compass 命令那类需要量化决策」的场景；进度条**快速扫读、语义强**，适合作「常驻 badge」。
  - UX 共识：**慢操作用确定进度条 + 百分比；不可量化用 spinner；<1s 的操作**不需要进度条（Cimpress 明确这条）。
  - 最佳实践是**两者叠加**：图形条表达「接近危险」的趋势，百分比给具体数字。本插件的「徽章 + hover 数字」正是这个组合。
- **颜色分级**：颜色只适合表达「离散档位/危险程度」，不应单独承载数值信息（见无障碍 §3.4）。

### 3.2 分级阈值的依据

- **业界硬阈值分布**（见 §2 各家）：
  - **80%** —— Copilot CLI 自动压缩起点；Codex 社区「逼近压缩区」线。
  - **90%** —— Codex 硬上限、Cline 触发线。
  - **95%** —— Copilot 暂停等待线、Codex 默认触发附近。
  - **70%** —— Cline 压缩后目标；Roo 可配置、默认更高。
  - **~50–60%** —— Codex 生态/社区建议的**主动 compact 点**（留足质量余量）。
- **「别等 100%」的原则有权威背书**：philschmid《Context Engineering》明确「定义 Pre-Rot Threshold：1M 窗口下性能常在 ~<256K（~25%）就开始下降，别等 API 报错，在进入 rot 区前就压缩/summarization」。Claude 官方亦承认 context rot：上下文越长、注意力被摊薄、性能越差。

> **对本插件的含义**：四档分级不应只按「硬容量」，更应体现「有效上下文/质量 rot」——
> - 绿（容量低、无 rot 压力）
> - 蓝（容量中）
> - 黄（逼近 rot 上限 / 经济成本高 / 压缩频繁）
> - 红（达到硬容量 / 经济当量超窗口预警 / 久未压缩）
> 现行 `windowHigh=0.5 / windowCritical=0.8` 与竞品「60% 主动 compact / 80% 过载」吻合；可补充「rot 提示面」解释价格。

### 3.3 hover 浮层 vs 常驻

- **关键实证：常驻可见比 hover 更好。** Cursor 把 context % 从常驻改为 hover-only 后成为论坛热点，用户明确指出「要时不时看的东西，每次 hover 每次都卡一次是摩擦」「它让我一瞥就知道该继续还是压缩还是新开」。Claude Code / Codex Desktop 移除常驻指示的 issue 也是同一诉求。
- **结论：占用 % 应该默认常驻可见（badge）；完整明细（缓存命中、成本、轮次、压缩次数）放 hover 浮层。** 本插件的「投影驱动 badge（零轮询常驻）+ 点击/悬停展开」正是对这种平衡的正解——常驻的是最关键的 1 个信号（健康/占用），其余延迟读取。
- 浮层应「就近展开」于徽章旁，避免遮挡输入区；提供关闭/延迟，尊重低运动偏好（本插件已实现 a11y 条目）。

### 3.4 无障碍（颜色 + 文字双重编码）

- **规范来源（GitHub Primer 进度条 a11y）**：
  - 「Progress bars can only be interpreted by sighted users. Include a text description to support assistive technologies like screen readers」——**必须给文字**，不能只靠颜色。示例文案「tasks: 8 of 10 complete」。
  - 多段相邻色块**对比度需 ≥ 3:1**。
  - 若旁边已有同值文本，可省略重复 label（避免冗余）。
- **通用 WCAG 共识（color-only status indicator 反例，issue 类来源）**：只靠颜色传达「成功/警告/错误」会漏掉色盲/高对比用户，需叠加**图标/文字/形状**。
  - 对本插件：绿/蓝/黄/红四档**必须配无颜色词的文字 label**（如「健康/留意/偏高/紧急」或直接文字「正常/风险」），色点只做增强层。OPTIMIZATION-RESEARCH.md 已列「浮层:无颜色词标签 + aria 保留、明暗 ≥3:1」——正是按此规范。
  - 徽章本体可补充 **aria-label**（如「上下文占用 80%，偏高」）让读屏器读出数字与档位。

---

## 4. 「继续 vs 新开会话」的产品化做法

> 业界把「会话交接（handoff）、checkpoint、压缩前提醒、会话归档/恢复」做成了哪些形态。

### 4.1 会话交接（handoff）—— 从「手动文档」到「自动生成」的生态缺口

- **OpenAI/Anthropic 官方都依赖「手工/半自动」交接**：Claude 的 `/compact` 摘要、Codex 的 `compact_prompt`（可定制结构化 handoff 提示：当前任务、改过的文件、决策与理由、阻塞点、下一步）、Copilot 压缩成「目标 + 做了什么 + 关键细节 + 计划下一步」的结构化摘要，本质上都是**「把交接写进压缩摘要」**。
- **独立「handoff 工具」生态出现**（说明工具自带不足，需外部补）：
  - `brief-ctx`：生成/维护一份 `PROJECT_CONTEXT.md`（50–80 行 project map），Pi / Claude Code / Codex / CLI 通用，跑 `/brief` 即可交接给下一个会话/代理。
  - `opencode-handoff` / AMP-like-handoff：生成用于在**新 OpenCode 会话继续工作**的 handoff prompt。
  - 这类工具的共性设计：**交接必须在“新会话开始前”做**，把「项目形态、最近改动、下一步」沉淀成可读文件，而不是依赖无法跨工具的记忆。
- **对本插件的含义**：`/compass` 里的「交接清单」与 `handoffDoc` 检查正是官方手写交接与第三方 handoff 工具之间的中间层——只读探测用户在 git + 交接文档是否就绪，把「能不能安全切」做成 check 项而非强制生成。与 brief-ctx 类的区别是：**本插件不生成内容，只评估就绪度**（决策归用户），更轻、更贴合「评估者」定位。

### 4.2 checkpoint —— 「新会话/回退」的安全网

- **Copilot CLI**：每次压缩自动生成 numbered、titled 的 checkpoint 文件，`/session checkpoints` 浏览，可从此摘要恢复——把「压缩点」变成可追溯的恢复点。
- **Cline / Roo Code**：Checkpoints 是时间线快照，支持把代码/对话回退到任意阶段；Roo 把 checkpoint 与压缩都做成显式状态。
- **Claude Code**：`/rewind`（回退到历史消息）、`/resume`（恢复旧会话）、`/fork` / `/branch`（分叉尝试另一方向）、`/clear`（干净开始）。它是交互式「会话树」，而非自动 checkpoint 文件。
- **对本插件的含义**：「继续 vs 新开」的**切换成本维度**应该检查『有没有可恢复的 checkpoint / git commit / 交接文档』——OPTIMIZATION-RESEARCH 里 `checks.sessionResume / checks.git / checks.handoff` 正是把「DSH 会话持久化 + git + 交接文档」当恢复能力来评估。这比竞品「只给 checkpoint 不评估可切性」更进一步。

### 4.3 压缩前提醒（主动 vs 被动）

- **主动维护派（应采纳）**：
  - Codex 生态：**「在 60% 而不是 95% 手动 compact」**，任务边界处压 + 带指令，留足质量空间。
  - philschmid：进入 **rot 区前**就压缩/summarization，不要等 API 报错。
  - Claude 博客：**休息/离开键盘前 `/compact`**——cache 一小时后过期，趁 cache 还在压更便宜。
  - Claude 决策表：「会话被陈旧调试信息塞满但任务未完 → `/compact <hint>`」「开始全新任务 → `/clear`」。
- **被动硬切派（应避免）**：
  - ChatGPT：**只在达上限后**弹「请新开对话」。
  - Cursor / 部分 CLI：满后自动 summarization 或直接截断。
  - Roo 的「错误后截断 25% 重试」是兜底而不是理想体验。
- **对本插件的含义**：**建议新会话应该是 proactive 的**——在占用达到 50–80% 且工作性质判断高成本时，由 `/compass` / `context_compass` 给出明确触发建议（danger-zone / suggest-switch），而不是等到 100% 硬顶。现行黄档「建议切换」/红档「危险区」即此主动语义。

### 4.4 会话归档 / 恢复

- Codex 生态「session lifecycle = archive / resume / fork / compact」；Claude `/resume` 从会话选择器恢复、`/fork` 复制成后台会话；Copilot `/resume` 可开 PR 关联会话。
- 普遍做法：会话持久化（CLI/桌面侧），下次可用 `/resume` 或会话列表恢复——「新会话」不意味着丢历史。「继续 vs 新开」的决策里，**恢复能力**是低成本安全项（DSH 的 JSONL 持久化天然支持，本插件已把它列进 sessionResume check）。

---

## 5. 成本 / 计费预期的业界共识（本插件「计费预期」维度的依据）

> 竞品大多只报「token / %」，本插件的「缓存命中 + 计费预期」是目前最领先且有官方背书的维度。

### 5.1 官方成本模型（Anthropic 博客，最权威）

- 每次请求成本 = **cache 读（历史，0.1x）+ 全价新输入（新增工具输出/文件）+ 输出（~5x 输入价）**。
- 典型一轮「几十 k 输入、几百输出」并**重发整个会话**。
- **会打爆 cache 的操作**：`/model`（每模型独立 cache）、`/effort`、fast mode、`/compact`（历史被替换、全失配）、**时间**（cache 过期：订阅 1h / API key 5min）。
  - 推论：**压缩最好趁 cache 还在时做**（休息前），resume 旧会话几乎必重新 prefill。
- **会话成本主变量**：多少 token 进过上下文 × 它们在多少轮里留着 × 同时跑几个上下文。

### 5.2 「有效上下文」/ 压缩代价

- 每次压缩都丢保真度：Codex「第一次通常无害、第二次降、第三次可能丢早期架构决策」；多次压缩损失早期上下文——**所以「压缩次数/比例」应被量化暴露**，本插件已做（浮层「已压缩 N 次」+ 计划压缩比例维度）。
- OpenAI 生态「死亡螺旋」是「压缩次数失控 + 无可见 telemetry」的极端后果。
- Cline 的压缩 tool call 显示成本、Roo 压缩显示前后 token + 成本——把「压缩」做成可见的、有价格的动作。

### 5.3 经济维度的「新会话」判据（官方策略）

- **什么时候继续省钱**：相关任务、上下文仍承载未落地的决策（git 可追溯）；继续**不重建**已缓存上下文。
- **什么时候新开省钱（或用 subagent 隔离）**：
  - 开始全新任务；
  - 对话塞满陈旧调试/探索输出（`/clear` 或 `/compact <hint>`）；
  - 下一阶段会产生大量「你只取结论」的中间输出（用 subagent，把噪声留在子上下文）。
- 这一判据与本插件「经济 > 容量」的优先级、「work nature 5 问」的 1a/1b 维度一致——业界已承认这是决策核心，只是没人产品化成彩级徽章。

---

## 6. 竞品空白与本插件差异化结论

| 需求（用户要什么） | 业界现状 | 本插件的占位 |
|---|---|---|
| 常驻可见的占用/健康指示 | Cursor 做但被移到 hover 引发反弹；Claude/Codex/JB 都在求「加回来」 | ✅ 投影驱动常驻 badge（绿/蓝/黄/红） |
| 四档健康分级 + 阈值 | 各家用「单一填充条」，无分级语义 | ✅ 四档 + 可配阈值（0.5/0.8 对齐竞品） |
| 缓存命中 / 计费预期 | 只有官方博客讲成本，产品内几乎不量化 | ✅ 浮层缓存命中率 + 金额（双币/忙闲时） |
| 压缩次数/比例 | 全行业空白，用户痛点明确 | ✅ 已压缩 N 次 + 压缩比例维度待补 |
| 建议新会话 | ChatGPT 只被动硬切；Claude 只有文字规则 | ✅ 主动 recommend（continue/suggest-switch/danger-zone + 两维矩阵） |
| 交接/切换成本评估 | 靠单独 handoff 工具，不在工具内 | ✅ /compass 交接清单 + git/会话恢复 check |
| 上下文“为什么高” | Coderex/Copilot 有结构拆分，Cursor 3.7 Canvas | ✅ 浮层展示窗口/轮次/消息数/占用构成（数据在 server 侧更精确） |
| 无障碍（非纯颜色） | 规范明确要文字+色双重编码 | ✅ 无颜色词 label + aria + 明暗 ≥3:1 |

---

## 7. 附注：关键来源

> 官方文档优先；次之官方博客/变更日志；再次可靠技术文章/社区。

**Cursor**
- 官方 Model/Usage：https://cursor.com/help/models-and-usage/usage-limits
- 官方 Agent 帮助（FAQ，上下文由系统提示/工具/规则构成）：https://cursor.com/help/ai-features/agent
- 官方 Changelog（Canvas / 上下文报告）：https://cursor.com/zh-Hant/changelog/canvas-improvements
- 3.7 Context Usage Report（可靠转载）：https://cyber-ivy.com/en/articles/cursor-37-context-usage-report-2026-06-05
- 常驻 % 被移除 → 用户反弹：https://forum.cursor.com/t/please-bring-back-the-always-visible-context-usage-percentage/165379
- 「不再显示 context 使用量，不知何时切新会话」：https://forum.cursor.com/t/why-is-the-latest-version-of-the-cursor-client-no-longer-displaying-the-context-window-usage-without-this-i-dont-know-when-i-should-switch-to-a-new-conversation/155989/4
- 空对话也 100%（全局 skills 计入占用 + 持续 summarization）：https://forum.cursor.com/t/100-context-used-event-in-new-task/155347

**Claude Code**
- 官方 Explore the context window：https://code.claude.com/docs/en/context-window
- 官方 Statusline（`context_window.used_percentage` 等字段）：https://code.claude.com/docs/en/statusline
- 官方 Common workflows（/resume /fork /branch /clear）：https://code.claude.com/docs/en/common-workflows
- 官方 Commands（/compact /context /usage /rewind）：https://code.claude.com/docs/en/commands
- 官方博客 Using Claude Code: session management and 1M context：https://claude.com/blog/using-claude-code-session-management-and-1m-context
- 官方博客 Maximizing the value of your Claude Code sessions（cache/成本/compact 时机）：https://claude.com/blog/maximizing-the-value-of-your-claude-code-sessions
- 社区：请求原生 context %：https://github.com/anthropics/claude-code/issues/39415 、https://github.com/anthropics/claude-code/issues/38971

**GitHub Copilot**
- 官方 CLI 上下文管理（80%/95%、/context、compaction、checkpoints）：https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management
- Copilot Learning Hub "Understanding Copilot Context"：https://github.com/github/awesome-copilot/blob/main/website/src/content/docs/learning-hub/understanding-copilot-context.md

**OpenAI Codex / ChatGPT**
- Codex CLI Context Compaction（90% 硬上限、双触发、blob vs 本地、死亡螺旋）：https://codex.danielvaughan.com/2026/03/31/codex-cli-context-compaction-architecture/
- Codex CLI Context Health Monitoring（/status %、>80% 逼近压缩区、60% 主动压缩、自建 telemetry）：https://codex.danielvaughan.com/2026/05/14/codex-cli-context-health-monitoring-compaction-telemetry-long-session-quality/
- Codex Desktop 移除常驻指示 issue：https://github.com/openai/codex/issues/23591 、https://github.com/openai/codex/issues/23794
- 社区：codex-context-used-meter：https://github.com/Minghou-Lei/codex-context-used-meter
- ChatGPT 达上限提示新开：https://community.openai.com/t/error-on-the-conversation-is-too-long-please-start-a-new-one/1383755
- Configurable token budget compaction reminder（openai/codex PR）：https://github.com/openai/codex/pull/29255

**Windsurf**
- 官方 Context Awareness Overivew（/ llms.txt）：https://docs.windsurf.com/context-awareness/overview；Memories & Rules：https://docs.windsurf.com/windsurf/cascade/memories.md
- 上下文组装管线（规则→记忆→编辑状态→@→flow→裁剪到窗口）：https://datalakehousehub.com/blog/2026-03-context-management-windsurf/

**Cline / Roo Code**
- Cline compaction 源码（90% / 70% / 20K / 128K）：https://cdn.jsdelivr.net/gh/cline/cline@main/sdk/packages/core/src/extensions/context/compaction-shared.ts
- Cline Auto Compact 官方文档（summarization tool call + cost）：https://docs.cline.bot/features/auto-compact
- Roo Code 智能上下文压缩（ContextWindowProgress、阈值滑块、前后 token + cost、30% 预留、25% 错误恢复）：https://roocode.ooos.top/features/intelligent-context-condensing/ （官方镜像：https://docs.roocode.com/features/intelligent-context-condensing）
- Cline Checkpoints：https://mintlify.wiki/cline/cline/core-workflows/checkpoints

**JetBrains AI**
- AI Chat 界面（无占用指示）：https://www.jetbrains.com/help/ai-assistant/ai-chat.html
- ACP 生态请求 usage_update 供客户端显示 context usage：https://github.com/QwenLM/qwen-code/issues/8513

**UX / 无障碍**
- GitHub Primer Progress Bar 无障碍（文字描述必须、3:1 对比）：https://primer.github.io/design/components/progress-bar/#accessibility
- Cimpress Progress Bar（base/success/warning/critical tone + label，80% 示例）：https://ui.cimpress.io/components/progress-bar/
- NN/g 可见性启发式（UX Planet 转载 Heuristic #1）：https://uxplanet.org/all-about-usability-heuristic-1-visibility-of-system-status-50e252522e41
- Color-only status indicator 需字号/图标（Radoub a11y issue）：https://github.com/LordOfMyatar/Radoub/issues/824

**有效上下文 / Pre-Rot 阈值**
- philschmid Context Engineering Part 2（Pre-Rot Threshold ~<256K/1M、别等 API 报错）：https://www.philschmid.de/context-engineering-part-2

**Handoff / Session 交接生态**
- brief-ctx（跨工具 project handoff 文档）：https://github.com/diomari/brief-ctx
- opencode-handoff（生成新会话 handoff prompt）：https://github.com/tektite-io/opencode-handoff

---

## 8. 对本插件的可借鉴点（按价值排序）

1. **「常驻可见 > hover」——别把占用 % 藏起来。** Cursor/Codex/Claude 把占用从常驻改 hover 或不做常驻都引发反弹。继续「投影驱动、零轮询的常驻 badge」，把完整明细留给浮层。这是本插件相对竞品最直接的对标胜点。（来源：Cursor forum 165379、openai/codex #23591）

2. **阈值应体现「有效上下文 / context rot」，而非只按硬容量 100%。** 权威参考明确「1M 窗口下 ~25% 起就性能下降」，竞品压缩线在 80–90%、主动推进在 60%。现行 0.5/0.8 的四档与竞品吻合；建议在浮层/H5 文案里加入「质量 rot」维度的解释，让黄档（偏高）不只是「容量高」，而是「接近 rot 区 + 缓存成本高」。（来源：philschmid、Claude session blog、Codex health）

3. **「建议新会话」要对齐 Claude 官方的取舍矩阵，做成 proactive。** 官方判据：相关任务→继续；塞满陈旧调试信息→compact；全新任务→clear；下一步很多中间输出→subagent。本插件的 continue/suggest-switch/danger-zone 已对应，可在 recommend 里按此给「该 compact 还是该新开」的细分，而非只有「切/不切」。（来源：Claude session blog 决策表）

4. **「压缩次数/比例」是全行业空白，也是最容易崩溃的无声风险（死亡螺旋）。** 竞品没有一家产品内展示压缩次数；Codex 死亡螺旋、Cline 丢上下文都源于「看不见压缩」。本插件已显示「已压缩 N 次」，**把压缩比例量化（推进 A1）价值最高**——这是别人没有、且最能预警质量塌方的指标。（来源：codex-compact 死亡螺旋、Codex health、cline #5790）

5. **把「压缩」做成可见、有价格的动作。** Cline 显示 summarization tool call + 成本；Roo 显示前后 token + 成本 + 可展开摘要。本插件浮层可补「每次压缩的当量/成本」，强化「压缩不是免费的」认知，促使用户在 50–60% 主动处理。（来源：cline auto-compact、Roo condensing）

6. **「成本/cache」维度有官方背书，是本插件最领先的护城河。** Claude 博客把 cache 读/写/超时、换模型打爆 cache、压缩时机讲透；竞品产品内几乎不量化。本插件的「缓存命中率 + 计费预期（金额/忙闲时）」应继续强化为卖点，并考虑把「切换/继续的经济差额」显式算出（继续 N 轮 vs 新开重建的 token 差）。（来源：Claude maximizing sessions blog）

7. **交接/切换成本检查是对标 handoff 工具生态的轻量替代。** brief-ctx / opencode-handoff 的价值是「新会话开始前沉淀上下文」；本插件的 `/compass` 交接清单 + handoffDoc + git/sessionResume check 是「评估已就绪否」，不生成内容。**可借鉴**：在红档危险区给出「下一步该补的交接项」清单（欠 commit / 缺交接文档 / 有运行中后端进程），与 option 生态互补而非重复。（来源：brief-ctx、opencode-handoff、OPTIMIZATION-RESEARCH checks）

8. **上下文「为什么高」的构成拆分值得纳入浮层。** Copilot `/context` 按 System/Tools/MCP/Messages/Free/Buffer 分类、Cursor 3.7 按 system prompt/工具/规则/skill/读文件拆分。本插件的 `tokenMeter` 已能量化，可参考在浮层或 `/compass minimal` 里给出「基线（系统/工具）+ 会话增长（消息/读文件）」的近似拆分，让用户知道该砍哪类。（来源：Copilot /context、Cursor 3.7）

9. **无障碍已按规范，保持并升级双编码。** Primer 规范「进度条只能被有视力用户解读，必须给文字 + 相邻色段 ≥3:1」。本插件无颜色词 label + aria + 明暗 ≥3:1 已达标；可补每个档位的读屏 aria `aria-label`（如「上下文占用 72%，偏高」），并把「当前占用%」作为 aria-valuetext 暴露。（来源：Primer progress-bar accessibility）

10. **会话生命周期术语可与用户心智对齐。** 业界通用：compact（压缩）、rewind（回退）、clear（全新开始）、resume/fork（恢复/分叉）、checkpoint（恢复点）。本插件文案用「继续 / 新开会话」，可在 `/compass` 的下一步建议里映射到 DSH 侧的等价动作（如「已 checkpoint 则放心切」「未 commit 请先 commit」），降低用户决策成本。（来源：Claude/Copilot/Codex 生命周期命令）

---

*本文为公开资料调研。部分工具（Windsurf/JetBrains 等）缺失原生占用指示，其「空白」判断基于官方文档/公开 issue 未提及该功能，可能滞后于闭源版本更新；如需，可加跑一次实测版本复核。*
