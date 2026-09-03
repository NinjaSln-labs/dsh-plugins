# GitHub README 规范格式与最佳实践调研（针对 dsh-context-compass）

> 用途：规范 dsh-context-compass 这个开源 npm 插件仓库的双语 README。
> 来源分级：**官方** = GitHub 官方文档/博客；**社区** = 知名开源规范/项目/讨论。检索时间：2026-03。

## 1. GitHub 官方对 README 结构的推荐

GitHub 官方没有发布"强制 README 模板"，但有明确的能力与内容推荐：

- 官方「About the repository README file」列出的典型内容：**项目做什么、为什么有用、如何上手、从哪里获得帮助、谁维护与贡献**；并明确 README 与 LICENSE、贡献指南、行为准则、citation 文件一起"传达项目期望"。README 放 `.github/`、仓库根或 `docs/` 都会被自动识别展示，多 README 的优先级为 `.github/` > 根 > `docs/`；**超过 500 KiB 会被截断**。[官方文档](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- 官方仓库最佳实践同样只要求"每个仓库都建 README"，不规定章节清单。[官方文档](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories)
- 官方建议 README 只放"开发者上手所需"内容，长文档放 wiki。[官方文档（About wikis）](https://docs.github.com/en/communities/documenting-your-project-with-wikis/about-wikis)

因此章节清单（徽章/安装/使用/贡献/许可）本质是**社区共识**，最权威的规范是 [standard-readme](https://github.com/RichardLitt/standard-readme)（其 spec 明确章节顺序与"必需/可选"状态：Title→Banner→Badges→Short Description→Long Description→ToC→Background→Install→Usage→API→Contributing→License，且 **Install/Usage 默认必需且必须含代码块、Contributing 与 License 必需、License 必须放最后**）。此外 [Best-README-Template](https://github.com/othneildrew/Best-README-Template) 提供了可直接抄的模板，属社区实践。

## 2. GitHub 渲染 README 的格式特性（官方确认）

- **相对链接/相对图片**：官方明确支持，相对链接按当前分支自动转换，可用 `./`、`../`、以 `/` 开头表示仓库根；**仓库内文件的引用官方推荐用相对链接**（clone 后仍可用，绝对链接在 clone 中可能失效）；仓库内图片同样建议相对路径。[官方文档](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)（此特性由 [GitHub 官方博客公告](https://github.blog/news-insights/product-news/relative-links-in-markup-files/)引入）
- **代码块语言高亮**：fenced code block 后加语言标识（```js / ```bash / ```ts），GitHub 用 Linguist 识别语言。[官方文档](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks)
- **TOC 自动生成**：README 渲染时 GitHub 按标题自动生成目录（Outline 图标），无需手写；heading 自动生成锚点链接。[官方文档](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
- **emoji**：`:EMOJICODE:` 语法受支持（官方文档同上页）。
- **徽章**：GitHub 无官方徽章规范；[shields.io](https://shields.io/) 是社区基建。**"徽章集中放标题后首行、新行分隔"是 standard-readme 的建议**；徽章应指向真实、可核验的状态（构建/版本/许可/下载量），动态优于静态。[shields.io 官方](https://shields.io/)、[community 讨论 160970](https://github.com/orgs/community/discussions/160970)
- **语言标签**：GitHub 仓库语言的"Language"统计由 Linguist 按代码占比自动得出，README 语言不影响该统计——README 里放"语言切换链接"属社区约定而非官方机制。

## 3. 单语 vs 双语 README：哪种更规范

GitHub **没有官方双语规范**，惯例来自 standard-readme（社区）与大型项目实践：

- standard-readme 的命名规则：多语言时 **`README.md` 保留给英文**，其余用 BCP 47 标签如 `README.de.md`、`README.zh-CN.md`；若全仓只有一份且非英文，可不带标签。[standard-readme spec](https://github.com/RichardLitt/standard-readme)
- GitHub 官方社区讨论中公认的机制：GitHub 默认只渲染根目录的 `README.md`，其余语言文件**不会被自动展示**，因此语言文件必须靠 `README.md` 顶部的语言切换链接导航，各语言文件顶部都要有互切链接。[官方 community discussion 31132](https://github.com/orgs/community/discussions/31132)、[github/markup issue 899](https://github.com/github/markup/issues/899)
- 命名上 `README.zh-CN.md`（BCP 47，standard-readme 推荐）与 `README.zh.md` / `README.en.md` / `README_zh.md`（HelloGitHub 等项目的简化实践）并存；**standard-readme 明确优先 BCP 47 的非地区子标签（zh 而非 zh-CN）**。
- 主流做法差异：英文为主的项目 → `README.md`(en) + `README.zh-CN.md`；**中文社区项目 → `README.md`(zh) + `README.en.md`**（HelloGitHub、多数国产项目）。维护上社区建议**单一事实来源**：声明一种语言为权威版本、翻译允许滞后，避免双语互相漂移。[Reddit r/github 讨论](https://www.reddit.com/r/github/comments/1jyx9uh/translate_readme_best_practices_and_tips/)

**对 dsh-context-compass 的建议**：目标读者以中文社区为主则维持现状（`README.md` 中文 + `README.en.md` 英文）完全符合实践；若想扩大国际受众，可反过来把英文设为 `README.md` 默认。关键点是**切换链接务必用相对链接**（当前 dsh-context-compass 用的是指向 GitHub blob 的绝对链接，clone 场景、镜像、或仓库改分支/改名都会断）。

## 4. 常见反模式

综合官方与社区共识：

1. **超长 README**：官方明确 README 只承载上手信息，>500 KiB 直接截断；[standard-readme](https://github.com/RichardLitt/standard-readme) 建议长内容下沉到 Background/API/外链文档。
2. **缺安装/使用示例**：standard-readme 把 Install、Usage 标为"默认必需且含可复制代码块"；[awesome-readme](https://github.com/matiassingers/awesome-readme) 总结的优秀 README 元素必含可运行示例。
3. **纯装饰徽章**：堆与项目无关的静态徽章（如大量技术栈贴纸）是公认反模式；徽章应少而准、动态、可点击验证。[daily.dev 徽章最佳实践](https://daily.dev/blog/readme-badges-github-best-practices/)、[community 讨论 160970](https://github.com/orgs/community/discussions/160970)
4. **README 与实际不符**：standard-readme 强制"无坏链"、描述与 package.json 的 `description` 及 GitHub 描述一致；版本号、功能截图过期会直接损害可信度。[standard-readme spec](https://github.com/RichardLitt/standard-readme)
5. **语言切换断链 / 双语内容漂移**：上文已述，切换必须相对链接、声明权威语言。[daytona 的 README 写作指南](https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project) 亦强调无坏链、无空章节。

## 5. 配套文件与 README 的链接规范（官方）

官方把 README 与 LICENSE、行为准则、贡献指南、citation 视为同一组"社区健康文件"，并推荐在 README 中链接它们：

- **LICENSE**：官方有专门页面指导仓库许可；standard-readme 要求 License 节用 SPDX 标识符并链接仓库内 LICENSE 文件。[官方文档](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
- **CODE_OF_CONDUCT.md / CONTRIBUTING.md / SECURITY.md**：官方提供模板与专页，且这些文件若存在于 `.github/`、根或 `docs/` 会被 GitHub 自动识别展示（community profile 会勾选完成度）。[CoC 官方文档](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-a-code-of-conduct-to-your-project)、[community profiles 官方文档](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories)、[SECURITY policy 官方文档](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository)、[opensource.guide](https://opensource.guide/)
- README 内引用这些文件**一律用相对链接**（如 `[Contributing](CONTRIBUTING.md)`、`[License](LICENSE)`），理由见第 2 点官方相对链接建议。

## 可操作结论（针对 dsh-context-compass）

1. **结构**：Title → 徽章行（npm version / license / CI，动态、≤4 枚）→ 一句简介（≤120 字符，与 package.json description 一致）→ 特性/截图 → **Install（可复制代码块）→ Usage（含真实示例）→ 配置说明 → API/文档链接 → Contributing → License**（License 放最后）。
2. **链接**：语言切换与内部文档一律改相对链接（`README.en.md`、`docs/…`）；图片入库内用相对路径。
3. **双语**：维持 `README.md`（中文权威）+ `README.en.md`，顶部加互切链接并声明"中文版为准，英文翻译可能滞后"；若改名 `README.zh-CN.md` 也符合 BCP 47 惯例，但需在 README 顶部导航说明。
4. **渲染细节**：代码块标注 `bash`/`ts`/`json` 语言；emoji 适度；>100 行的长目录依赖 GitHub 自动 Outline，不必手写巨型 TOC；不超过 500 KiB。
5. **配套文件**：补 LICENSE、CONTRIBUTING.md（或至少 README 内 Contributing 节链接 issues）、SECURITY.md（插件涉及 token 定价/设置，安全策略有意义），并在 README 内相对链接引用。
