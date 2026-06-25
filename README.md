# AI4Zotero

<p align="center">
  <a href="#中文说明"><kbd>中文</kbd></a>
  <a href="#english-readme"><kbd>English</kbd></a>
</p>

## 中文说明

AI4Zotero 是一个面向 Zotero 9 的中文文献阅读助手插件。它会在 Zotero 阅读器右侧栏中加入 AI 面板，让你在阅读论文时直接向 DeepSeek 提问、解释划线内容、总结方法和实验结果。

### 主要功能

- 在 Zotero 阅读器右侧栏加入 `AI` 入口按钮和 `AI 阅读助手` 面板。
- 支持在面板中配置 DeepSeek API Key、接口地址和模型。
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

填写后点击 `保存`。如果想确认 Key 是否可用，可以点击 `测试连接`。

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

### 划线提问

在 Zotero 阅读器中选中一段文字后，弹出的选择工具条里会出现“问 AI”。点击后，AI4Zotero 会自动打开右侧面板，并把划线内容放入上下文。

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
- Lets you configure a DeepSeek API key, endpoint, and model inside the panel.
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

Click `Save`. Use `Test Connection` if you want to verify the key.

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

### Selection Q&A

Select text in the Zotero Reader and click “问 AI” in the selection popup. AI4Zotero will open the side panel and add the selected text to the context.

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
