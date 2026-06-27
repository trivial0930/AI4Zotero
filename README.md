# AI4Zotero

<p align="center">
  <a href="dist/ai4zotero.xpi">
    <img src="docs/ai4zotero-icon.png" alt="AI4Zotero icon" width="160">
  </a>
</p>

<p align="center">
  <a href="#中文说明"><kbd>中文</kbd></a>
  <a href="#english-readme"><kbd>English</kbd></a>
</p>

## 中文说明

AI4Zotero 是一个面向 Zotero 9 的中文文献阅读助手插件。它会在 Zotero 阅读器右侧栏中加入 AI 面板，让你在阅读论文时直接向 DeepSeek 提问、解释划线内容、总结方法和实验结果。

### 主要功能

- 在 Zotero 阅读器右侧栏加入 `AI` 入口按钮和 `AI 阅读助手` 面板。
- 右侧栏入口使用 AI4Zotero 图标按钮，点击即可打开助手。
- 支持在面板中配置 DeepSeek API Key、接口地址和模型。
- 配置完成后设置提示会自动收起，避免阅读时长期占用空间。
- 支持 `紧凑`、`标准`、`舒适` 三档阅读字号。
- 支持思考强度和语言风格设置。
- 自动跟随当前打开的文献刷新上下文，界面只显示文献标题，不再占用提问空间。
- 支持常见 Markdown 回答渲染，包括标题、列表、粗体和行内代码。
- 统一支持多模态输入架构：文本、图片和文件会进入同一套问答请求流程。
- 采用接近 alphaXiv Assistant 的阅读 UI：顶部标签、`新对话`、引导卡片和底部大输入框。
- 自动读取当前文献的标题、作者、摘要、划线内容、最近批注和 Zotero 已索引全文。
- 支持划线后点击“问 AI”，自动把划线内容带入上下文。
- 提供常用中文快捷问题：论文速览、研究问题、方法拆解、实验结果、解释划线。
- 支持在 Zotero 顶部工具栏、工具菜单和 Reader 工具栏打开同一个 AI 面板。

### DeepSeek 默认配置

- 接口地址：`https://api.deepseek.com/chat/completions`
- 默认模型：`deepseek-v4-flash`

API Key 会保存在 Zotero 本地偏好设置中，不会写入仓库或插件包。

### 安装方法

1. 下载或构建 `dist/ai4zotero.xpi`。
2. 打开 Zotero。
3. 进入 `工具` -> `插件`。
4. 点击插件页面右上角的齿轮按钮。
5. 选择 `Install Plugin From File...` 或“从文件安装插件”。
6. 选择 `dist/ai4zotero.xpi`。
7. 按 Zotero 提示重启。

### 配置 API

安装后打开一篇 PDF 或 EPUB，在右侧栏底部点击 `AI` 按钮。

在 AI 阅读助手面板中填写：

- `API Key`：你的 DeepSeek API Key。
- `接口地址`：默认即可，一般不需要修改。
- `模型`：默认 `deepseek-v4-flash`。
- `思考强度`：`快速`、`均衡`、`深入`。
- `语言风格`：`学术严谨`、`简洁直接`、`讲解式`、`审稿人视角`。
- `阅读字号`：根据阅读距离选择 `紧凑`、`标准` 或 `舒适`。

填写后点击 `保存`。如果 API Key 已填写，设置区会自动收起；如果想确认 Key 是否可用，可以再次打开设置并点击 `测试连接`。

### 使用方式

打开 AI 面板后，可以直接在底部输入框提问，例如：

- “这篇论文的核心贡献是什么？”
- “请用中文解释第 3 节的方法。”
- “实验结果是否足以支持作者的结论？”
- “这篇论文和我正在做的方向有什么关系？”

也可以点击面板中的快捷按钮：

- `论文速览`：快速总结论文主线。
- `研究问题`：解释论文要解决的问题和意义。
- `方法拆解`：梳理论文方法、组件和实验设计。
- `实验结果`：提取主要结果并解释结论。
- `解释划线`：结合当前划线内容进行解释。

面板会自动识别当前打开的 Zotero 阅读器文献，并在后台更新标题、摘要、批注、划线内容和 Zotero 索引全文；侧栏只显示文献标题，不再展示大块上下文文本框。

底部输入框支持：

- 插入图片或上传文件。
- 调节思考强度。
- 切换语言风格。
- 使用统一的多模态消息结构，DeepSeek V4 等多模态模型可以接收图片输入。

### 划线提问

在 Zotero 阅读器中选中一段文字后，弹出的选择工具条里会出现“问 AI”。点击后，AI4Zotero 会自动打开右侧面板，并把划线内容放入上下文。

### 1.0.0 更新

- 修复 DeepSeek Markdown 回答原样显示的问题。
- 配置成功后不再显示常驻状态横幅。
- 新增阅读字号设置，改善长回答的可读性。
- 重做侧栏视觉结构，更接近 alphaXiv Assistant 的阅读工作流。

### 1.1.0 更新

- 当前文献上下文会自动跟随打开的 PDF/EPUB 更新。
- 新增图片/文件输入入口。
- 新增模型输入、思考强度和语言风格设置。
- 问答格式改为更接近参考图的阅读排版：用户问题灰底、Thinking Finished、回答反馈按钮。
- 早期版本曾区分文本模型和多模态模型；新版已统一为多模态架构。

### 1.2.0 更新

- 新增 AI4Zotero 应用图标资源。
- 右侧栏浮动入口改为可点击图标按钮。
- README 顶部加入可点击图标，点击可打开 `dist/ai4zotero.xpi`。

### 1.3.0 更新

- 统一为多模态模型架构，DeepSeek V4 也按多模态输入处理。
- 删除侧栏中的大块“文献上下文”文本框，后台仍自动同步并发送上下文。
- 界面只保留当前文献标题，释放聊天区和提问输入空间。
- 图片附件会作为多模态图片内容发送，文本文件继续作为补充文本上下文。

### 1.3.1 更新

- 修复助手面板打开后右下角图标按钮仍显示、遮挡发送按钮的问题。
- 优化侧栏满高布局，让聊天区和底部输入器更充分利用垂直空间。

### 1.3.2 更新

- 收尾自查并清理旧的文本模型残留代码。
- 连接测试也统一使用多模态消息结构。
- 重新打包并校验发布包，确保插件版本、更新清单和 XPI 一致。

### 1.3.3 更新

- 输入框支持 `Enter` 直接发送，`Shift+Enter` 保留换行。
- 修正顶部关闭按钮图标的居中和对称显示。

### 1.3.4 更新

- 修复 Markdown 水平分隔线渲染，支持 `---`、`***` 和 `___`。

### 自检流程

每次发布前至少检查：

1. 语法：`node --check bootstrap.js`。
2. 打包：`./scripts/build-xpi.sh`。
3. 压缩包：`unzip -t dist/ai4zotero.xpi`。
4. Zotero 实机安装：确认插件能启动、右侧栏 `AI` 按钮可见。
5. 面板交互：确认设置、刷新、关闭、快捷问题、底部提问框可用。
6. 日志：确认 Zotero debug log 中没有 `ReferenceError`、`TypeError`、`SyntaxError`。

### 构建插件

```bash
./scripts/build-xpi.sh
```

构建完成后会生成：

```text
dist/ai4zotero.xpi
```

### 常见问题

#### 右侧栏没有看到 AI 面板

请先确认插件已经启用，并打开任意 PDF/EPUB。右侧栏底部会出现一个 `AI` 按钮，点击即可打开面板。

#### 点击提问没有回答

请检查三件事：

- 是否已经填写 DeepSeek API Key。
- DeepSeek 账号是否有可用额度。
- 网络是否能访问 `https://api.deepseek.com`。

#### 能读取整篇论文吗

插件会优先读取 Zotero 已索引的全文缓存。如果 Zotero 尚未完成全文索引，面板仍会读取标题、作者、摘要、划线和批注，但全文上下文可能不完整。

## English README

AI4Zotero is a Zotero 9 plugin that adds an AI reading assistant to the Zotero Reader side pane. It lets you ask DeepSeek questions about the current paper, explain selected text, summarize methods, and inspect experimental results while reading.

### Features

- Adds an `AI` entry button and an `AI Reading Assistant` panel to the Zotero Reader side pane.
- Uses the AI4Zotero icon as a clickable right-pane entry button.
- Lets you configure a DeepSeek API key, endpoint, and model inside the panel.
- Automatically collapses setup notices after DeepSeek is configured.
- Adds compact, standard, and comfortable reading font sizes.
- Adds reasoning effort and language style controls.
- Automatically follows the currently opened paper while showing only the paper title, so the composer has more room.
- Renders common Markdown responses, including headings, lists, bold text, and inline code.
- Uses a unified multimodal input architecture for text, images, and files.
- Uses an alphaXiv Assistant-inspired reading UI with top tabs, New Chat, onboarding cards, and a larger bottom composer.
- Reads the current paper title, authors, abstract, selected text, recent annotations, and Zotero indexed full-text cache when available.
- Adds a “问 AI” selection action to the Reader text-selection popup.
- Includes quick prompts for summary, research problem, methods, results, and selected-text explanation.
- Opens the same assistant from the Zotero toolbar, Tools menu, Reader toolbar, or right side pane.

### DeepSeek Defaults

- Endpoint: `https://api.deepseek.com/chat/completions`
- Model: `deepseek-v4-flash`

The API key is stored locally in Zotero preferences. It is not written to the repository or the plugin package.

### Installation

1. Download or build `dist/ai4zotero.xpi`.
2. Open Zotero.
3. Go to `Tools` -> `Plugins`.
4. Click the gear icon in the plugin page.
5. Choose `Install Plugin From File...`.
6. Select `dist/ai4zotero.xpi`.
7. Restart Zotero if prompted.

### API Setup

Open a PDF or EPUB after installation, then click the `AI` button near the bottom of the right side pane.

In the assistant panel, fill in:

- `API Key`: your DeepSeek API key.
- `Endpoint`: keep the default unless you use a custom compatible endpoint.
- `Model`: default is `deepseek-v4-flash`.
- `Reasoning effort`: fast, balanced, or deep.
- `Language style`: academic, concise, teacher-like, or reviewer-like.
- `Reading font size`: choose compact, standard, or comfortable.

Click `Save`. When an API key is present, the settings area collapses automatically. Reopen settings and use `Test Connection` if you want to verify the key.

### Usage

You can ask questions from the composer at the bottom of the panel, for example:

- “What is the main contribution of this paper?”
- “Explain Section 3 in Chinese.”
- “Are the experimental results sufficient to support the conclusion?”
- “How is this paper related to my research topic?”

Quick prompt buttons are available for:

- Paper overview
- Research problem
- Method breakdown
- Experimental results
- Selected text explanation

The panel automatically tracks the currently opened Zotero Reader paper and refreshes title, abstract, annotations, selected text, and Zotero indexed full-text context in the background. The side pane only shows the current paper title.

The composer supports:

- Inserting images or uploading files.
- Adjusting reasoning effort.
- Switching language style.
- Sending images through the same multimodal message structure used by DeepSeek V4-style models.

### Selection Q&A

Select text in the Zotero Reader and click “问 AI” in the selection popup. AI4Zotero will open the side panel and add the selected text to the context.

### 1.0.0 Update

- Fixed raw Markdown output in DeepSeek answers.
- Removed the persistent configured-status banner.
- Added adjustable reading font sizes.
- Redesigned the side panel around an alphaXiv Assistant-style reading workflow.

### 1.1.0 Update

- Automatically refreshes context from the currently opened PDF/EPUB.
- Adds image/file input entry points.
- Adds model capability, reasoning effort, and language style settings.
- Updates the Q&A layout with a grey user bubble, Thinking Finished bar, and answer feedback actions.
- Earlier versions separated text-only and multimodal model paths; the current version uses a unified multimodal architecture.

### 1.2.0 Update

- Adds the AI4Zotero app icon asset.
- Replaces the right-pane floating entry with a clickable icon button.
- Adds a clickable README icon that links to `dist/ai4zotero.xpi`.

### 1.3.0 Update

- Unifies the plugin around a multimodal model architecture, including DeepSeek V4.
- Removes the large visible paper-context textarea while still syncing context in the background.
- Shows only the current paper title in the UI to free space for chat and the composer.
- Sends image attachments as multimodal image content and text files as supplemental context.

### 1.3.1 Update

- Hides the floating icon button whenever the assistant panel is open, preventing it from covering the send button.
- Improves full-height side-pane layout so the chat area and bottom composer use vertical space more effectively.

### 1.3.2 Update

- Final self-review cleanup for stale text-model code.
- Uses the unified multimodal message shape for connection tests too.
- Rebuilds and verifies the release package so the manifest, update feed, and XPI match.

### 1.3.3 Update

- Press `Enter` to send and `Shift+Enter` to insert a newline.
- Centers the close icon for a more balanced top bar.

### 1.3.4 Update

- Fixes Markdown horizontal rule rendering for `---`, `***`, and `___`.

### Release Checklist

Before each release, check:

1. Syntax: `node --check bootstrap.js`.
2. Build: `./scripts/build-xpi.sh`.
3. Package integrity: `unzip -t dist/ai4zotero.xpi`.
4. Zotero install: confirm the plugin starts and the right-pane `AI` button is visible.
5. Panel interactions: confirm settings, refresh, close, quick prompts, and composer work.
6. Logs: confirm there are no `ReferenceError`, `TypeError`, or `SyntaxError` entries in the Zotero debug log.

### Build

```bash
./scripts/build-xpi.sh
```

The output is:

```text
dist/ai4zotero.xpi
```

### FAQ

#### I cannot see the AI panel in the right side pane

Make sure the plugin is enabled and open any PDF/EPUB. The right side pane should show an `AI` button near the bottom.

#### Asking questions does not return an answer

Check that:

- Your DeepSeek API key is configured.
- Your DeepSeek account has available balance.
- Your network can access `https://api.deepseek.com`.

#### Can it read the whole paper?

The plugin uses Zotero indexed full-text cache when available. If Zotero has not indexed the attachment yet, AI4Zotero can still read metadata, abstract, selected text, and annotations, but full-paper context may be incomplete.
