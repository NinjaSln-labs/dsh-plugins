# dsh-subagent-router — 动词提取 + 四档分档计划

> 状态：**已原型验证（2026-08-30）· 方案确认可行 · 代码待实施** · 目标：将 `classifyTier` 从三档（trivial/standard/complex）扩展为四档（trivial/light/standard/complex），并引入动词提取取代纯英文正则标记，消除中文任务被系统性低估的问题

## 1. 背景与动机

### 问题

`classifyTier` 的 `COMPLEX_MARKERS` 14 个正则全部为英文，导致中文任务描述的系统性偏差：

| 任务 | 当前行为 | 应有 |
|------|---------|------|
| "Voyage 全网调研" | `standard`（中文"调研"不匹配英文 research） | `complex` |
| "分析这组数据" | `standard`（中文"分析"不匹配英文 analyze） | `complex` |
| "重构代码库" | `standard`（中文"重构"不匹配英文 refactor） | `standard` |
| "列一下今天的文件" | `standard`（无英文标记） | `trivial` |

同时，`standard` 档跨度太大（160~1200 字符），"写个排序函数"和"设计微服务架构"在同一档，但所需模型强度不同——这导致一般中文 prompt 几乎总是落 `standard`，既选不中复杂任务应有的强模型，也选不到简单任务应有的便宜模型。

### 解决方案（已原型验证可行）

**动词提取 + 四档系统**，不依赖 LLM、不依赖翻译 API、不依赖分词器：
1. 从 prompt 首句中提取核心动词，查中英双语字典确定档位
2. 四档细化：trivial → light → standard → complex
3. 动词字典未知时退化到长度启发式

## 2. 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 动词提取源 | prompt 首句（前 200 字符，按标点截断），description 备用 | description 不保证含动词；prompt 首句结构更可靠 |
| 动词匹配方式 | 子串匹配（`head.includes(verb)`），无需分词器 | 轻量、零外部依赖；中文动词是短词可直接子串匹配 |
| 翻译归一化 | **放弃翻译 API** | 动词字典原生支持中英双语，比"翻译后再查英文标记"更轻、更快、无失败路径 |
| 中文单字动词 | 用 `COMPOUND_PREFIX` 排除复合词（如"序列"→不匹配"列"） | 防误配"调查"等复合词 |
| 提取失败回退 | 长度启发式（160/400/1200 阈值） | 保持向后兼容 |
| 四档模型选择 | trivial→最低分 · light→平衡(0分) · standard→强(≥1分) · complex→最高分 | 更细粒度匹配任务强度 |

## 3. 实施任务

### 3a: 动词字典（`VERB_TIER_MAP`）

中英双语，4 档：

| 档位 | 中文动词 | 英文动词 |
|------|---------|---------|
| complex | 分析、研究、调研、评估、调查、推导、架构、设计、综合、迁移、集成、验证 | analyze, research, investigate, design, evaluate, synthesize, derive, architect, migrate, integrate, validate |
| standard | 实现、重构、优化、调试、编写、修改、构建、开发、测试、配置、部署 | implement, refactor, optimize, debug, write, modify, build, develop, test, configure, deploy |
| light | 总结、翻译、创建、更新、添加、删除、复制、移动、重命名、转换、提取、生成 | summarize, translate, create, update, add, delete, copy, move, rename, convert, extract, generate |
| trivial | 查看、列出、显示、搜索、检查、读取、寻找、查询、浏览、打开 + 单字（列/查/找/看） | list, show, find, check, read, search, look, browse, open, view, ls, cat, grep |

**单字动词**（列/查/找/看）需规避复合词，规避表（`COMPOUND_PREFIX`）：`列` 前是 序列/排/陈/罗 → 不匹配；`查` 前是 调/检/审/普 → 不匹配；`找` 前是 寻 → 不匹配；`看` 前是 查 → 不匹配。礼貌前缀（请/帮/给）后仍匹配。

**文件**：`src/tools.ts`

### 3b: 四档分档算法

```
classifyTier(description, prompt):
  1. 长度 ≥ 1200 → complex（快速路径）
  2. 含代码标记 → complex（快速路径，保留现有 COMPLEX_MARKERS）
  3. 动词提取（prompt 首句 → 查字典）
  4. 动词提取失败 → 长度启发式：
     ≤ 160 → trivial
     ≤ 400 → light
     > 400 → standard
```

**文件**：`src/tools.ts`

### 3c: 类型与模型选择扩展

- `src/index.ts`：`AutoTierPolicy` 和 `autoTierPicks` 类型加 `'light'`
- `src/config.ts`：schemastery schema 加 `light` 档位
- `src/tools.ts`：`pickModel` 四档逻辑 + `NEXT_TIER` 升级链（trivial→light→standard→complex）+ `tierNote` 加 light 说明

### 3d: 测试

- **文件**：`tests/tools.spec.ts` + 独立动词提取用例
- **用例**：
  1. 动词提取：中文复杂（分析/调研/设计）+ 中文标准（重构/实现）+ 中文 light（总结/翻译）+ 中文 trivial（列/查/找/看）
  2. 复合词规避：调查→查不误配；序列→列不误配
  3. 礼貌前缀：请列/帮查/给我→仍匹配
  4. 英文动词：analyze/research/list/write
  5. 四档模型选择：trivial→cheapest / light→平衡 / standard→strong / complex→strongest

## 4. 影响分析（原型实测结果）

### 动词提取准确率（原型 19 例，18 命中）

| 任务 | 结果 | 说明 |
|------|-----|------|
| "列一下今天的文件" | trivial ✅ | 单字"列"开头 |
| "请查一下数据" | trivial ✅ | 前缀"请"+单字"查" |
| "帮我查一下" | trivial ✅ | 前缀"帮"+单字"查" |
| "调查一下这个情况" | complex ✅ | 复合词"调查"→complex，不误配"查" |
| "序列化数据" | trivial ✅ | 复合词"序列"→不误配"列"，长度回退 |
| "分析这组数据" | complex ✅ | 中文"分析" |
| "Voyage 全网调研" | complex ✅ | 中文"调研" |
| "重构代码库" | standard ✅ | 中文"重构" |
| "设计微服务架构" | complex ✅ | 中文"设计" |
| "Analyze this data" | complex ✅ | 英文 analyze |
| "Go through and write up summary" | standard ✅ | 英文 write |

### 四档模型选择映射

| 档位 | pickModel 逻辑 | 典型模型 | 升级路径 |
|------|---------------|---------|---------|
| trivial | score.min（最便宜） | nano/tiny | → light |
| light | score === 0（平衡） | flash | → standard |
| standard | score >= 1（强） | pro/code | → complex |
| complex | score.max（最强） | max/ultra | — |

## 5. 验收标准

1. ✅ 原型验证：19 个动词提取场景 18 命中（含中英双语、复合词规避、礼貌前缀）
2. ✅ 原型验证：106/106 现有测试不退化（实验代码下全绿）
3. ✅ 四档模型选择符合映射：trivial→cheapest / light→平衡 / standard→strong / complex→strongest
4. ✅ 中文重任务（调研/分析/设计）能进 complex；中文轻任务（列/查/看看）能进 trivial/light
5. ✅ 不引入 LLM、翻译 API、分词器等外部依赖
6. ✅ 动词字典未知时正确回退到长度启发式
7. ✅ 配置 schema（autoTierPolicy/autoTierPicks）接受 `light` 档，旧 3 档配置仍兼容

## 6. 不做的

- 不加中文/小语种到 `COMPLEX_MARKERS` 正则（用动词字典替代，多语言按需扩展字典更可持续）
- 不做全文翻译归一化（动词提取更轻、更快、无失败路径）
- 不改 `trivial`/`standard`/`complex` 三档的既有模型选择语义（只新增 `light` 并调整 `standard` 从"0 分"到"≥1 分"）
- 不砍长度/代码标记快速路径（它们是 cheap 时的保底）