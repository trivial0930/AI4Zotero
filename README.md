# AI4Zotero

AI4Zotero 是一个面向 Zotero 9 的中文文献阅读助手插件。它会在 Zotero 阅读器右侧栏中加入 AI 面板，让你在阅读论文时直接向 DeepSeek 提问、解释划线内容、总结方法和实验结果。

## 主要功能

- 在 Zotero 阅读器右侧栏加入 `AI` 入口按钮和 `AI4Zotero` 面板。
- 支持在面板中配置 DeepSeek API Key、接口地址和模型。
- 自动读取当前文献的标题、作者、摘要、划线内容、最近批注和 Zotero 已索引全文。
- 支持划线后点击“问 AI”，自动把划线内容带入上下文。
- 提供常用中文快捷问题：论文速览、研究问题、方法拆解、实验结果、解释划线。
- 支持在 Zotero 顶部工具栏、工具菜单和 Reader 工具栏打开同一个 AI 面板。

## DeepSeek 默认配置

- 接口地址：`https://api.deepseek.com/chat/completions`
- 默认模型：`deepseek-v4-flash`

API Key 会保存在 Zotero 本地偏好设置中，不会写入仓库或插件包。

## 安装方法

1. 下载或构建 `dist/ai4zotero.xpi`。
2. 打开 Zotero。
3. 进入 `工具` -> `插件`。
4. 点击插件页面右上角的齿轮按钮。
5. 选择 `Install Plugin From File...` 或“从文件安装插件”。
6. 选择 `dist/ai4zotero.xpi`。
7. 按 Zotero 提示重启。

## 配置 API

安装后打开一篇 PDF 或 EPUB，在右侧栏底部点击 `AI` 按钮。

在 AI4Zotero 面板中填写：

- `API Key`：你的 DeepSeek API Key。
- `接口地址`：默认即可，一般不需要修改。
- `模型`：默认 `deepseek-v4-flash`。

填写后点击 `保存`。如果想确认 Key 是否可用，可以点击 `测试连接`。

## 使用方式

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

## 划线提问

在 Zotero 阅读器中选中一段文字后，弹出的选择工具条里会出现“问 AI”。点击后，AI4Zotero 会自动打开右侧面板，并把划线内容放入上下文。

## 构建插件

```bash
./scripts/build-xpi.sh
```

构建完成后会生成：

```text
dist/ai4zotero.xpi
```

## 常见问题

### 右侧栏没有看到 AI 面板

请先确认插件已经启用，并打开任意 PDF/EPUB。右侧栏底部会出现一个 `AI` 按钮，点击即可打开面板。

### 点击提问没有回答

请检查三件事：

- 是否已经填写 DeepSeek API Key。
- DeepSeek 账号是否有可用额度。
- 网络是否能访问 `https://api.deepseek.com`。

### 能读取整篇论文吗

插件会优先读取 Zotero 已索引的全文缓存。如果 Zotero 尚未完成全文索引，面板仍会读取标题、作者、摘要、划线和批注，但全文上下文可能不完整。

## 开发说明

这是一个无前端构建步骤的 Zotero bootstrap 插件。主要逻辑位于 `bootstrap.js`，界面样式位于 `chrome/skin/assistant.css`，本地化文本位于 `locale/`。
