# AI4Zotero

AI4Zotero is a Zotero 9 plugin for asking DeepSeek questions while reading papers.

## What It Does

- Adds an `AI4Zotero` entry to Zotero's toolbar and `Tools` menu.
- Adds an `AI` button to the Zotero Reader toolbar.
- Opens a right-side AI panel next to the active Zotero tab.
- Lets you configure your DeepSeek API key, endpoint, and model inside the panel.
- Reads the active reader item, parent metadata, abstract, recent annotations, selected text, and Zotero full-text cache when available.
- Adds `Ask AI` to the Reader text-selection popup.
- Adds an annotation context-menu action for asking about selected annotations.
- Includes quick prompts for summary, selection explanation, methods, and limitations.

## DeepSeek Defaults

- Endpoint: `https://api.deepseek.com/chat/completions`
- Model: `deepseek-v4-flash`

The API key is stored locally in Zotero preferences.

## Install

1. Download or build `dist/ai4zotero.xpi`.
2. Open Zotero.
3. Go to `Tools` -> `Plugins`.
4. Click the gear icon and choose `Install Plugin From File...`.
5. Select the `.xpi` file.
6. Restart Zotero if prompted.

## Configure API

Open AI4Zotero from any of these places:

- Zotero toolbar: `AI4Zotero`
- Zotero menu: `Tools` -> `AI4Zotero Settings`
- Reader toolbar while viewing a PDF/EPUB: `AI`

Then enter your DeepSeek API key in the panel and click `Save` or `Test`.

## Build

```bash
./scripts/build-xpi.sh
```

This creates:

```text
dist/ai4zotero.xpi
```

## Notes

This is a no-build Zotero bootstrap plugin. Reader integrations use Zotero 9's `Zotero.Reader.registerEventListener()` API.
