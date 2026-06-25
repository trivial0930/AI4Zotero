/* global Zotero */

var Services;
try {
  ({ Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs"));
} catch (e) {
  ({ Services } = ChromeUtils.import("resource://gre/modules/Services.jsm"));
}

const DeepSeekAssistant = {
  id: "ai4zotero@trivial0930.github.io",
  appName: "AI4Zotero",
  paneID: "ai4zotero",
  registeredPaneID: "",
  rootURI: "",
  windows: new Map(),
  readerHandlers: [],
  prefs: {
    apiKey: "extensions.ai4zotero.apiKey",
    endpoint: "extensions.ai4zotero.endpoint",
    model: "extensions.ai4zotero.model",
    systemPrompt: "extensions.ai4zotero.systemPrompt",
    maxContextChars: "extensions.ai4zotero.maxContextChars"
  },
  defaults: {
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    systemPrompt:
      "You are a careful academic reading assistant. Answer in the user's language. " +
      "Use the supplied paper context when it is relevant, cite quoted snippets briefly, " +
      "and say when the context is insufficient.",
    maxContextChars: 14000
  },

  startup(data) {
    this.id = data.id || this.id;
    this.rootURI = data.rootURI || "";
    this.ensureDefaultPrefs();
    this.registerItemPaneSection();
    this.registerReaderHooks();
  },

  shutdown() {
    this.unregisterReaderHooks();
    this.unregisterItemPaneSection();
    for (let win of this.windows.keys()) {
      this.unloadWindow(win);
    }
    this.windows.clear();
  },

  ensureDefaultPrefs() {
    this.setDefaultCharPref(this.prefs.endpoint, this.defaults.endpoint);
    this.setDefaultCharPref(this.prefs.model, this.defaults.model);
    this.setDefaultCharPref(this.prefs.systemPrompt, this.defaults.systemPrompt);
    this.setDefaultIntPref(this.prefs.maxContextChars, this.defaults.maxContextChars);
  },

  setDefaultCharPref(name, value) {
    let branch = Services.prefs.getDefaultBranch("");
    try {
      branch.setCharPref(name, value);
    } catch (e) {
      Zotero.debug(`DeepSeek Assistant: failed setting default pref ${name}: ${e}`);
    }
  },

  setDefaultIntPref(name, value) {
    let branch = Services.prefs.getDefaultBranch("");
    try {
      branch.setIntPref(name, value);
    } catch (e) {
      Zotero.debug(`DeepSeek Assistant: failed setting default pref ${name}: ${e}`);
    }
  },

  loadWindow(win) {
    if (this.windows.has(win)) {
      return;
    }

    let stylesheet = this.injectStylesheet(win);
    this.injectLocalization(win);

    let doc = win.document;
    let button = doc.createXULElement("toolbarbutton");
    button.id = "ai4zotero-toolbar-button";
    button.className = "zotero-tb-button";
    button.setAttribute("label", "AI4Zotero");
    button.setAttribute("tooltiptext", "Open AI4Zotero");
    button.addEventListener("command", () => this.togglePanel(win, { focus: "question" }));

    let toolbar = doc.getElementById("zotero-tabs-toolbar") || doc.getElementById("zotero-toolbar");
    if (toolbar) {
      toolbar.appendChild(button);
    }

    let menuitem = this.createToolsMenuItem(win);

    let state = { button, menuitem, stylesheet };
    this.windows.set(win, state);
  },

  unloadWindow(win) {
    let state = this.windows.get(win);
    if (!state) {
      return;
    }
    state.button?.remove();
    state.menuitem?.remove();
    state.stylesheet?.remove();
    win.document.querySelector('[href="ai4zotero.ftl"]')?.remove();
    this.windows.delete(win);
  },

  injectStylesheet(win) {
    if (!this.rootURI) {
      return null;
    }
    let pi = win.document.createProcessingInstruction(
      "xml-stylesheet",
      `href="${this.rootURI}chrome/skin/assistant.css" type="text/css"`
    );
    win.document.insertBefore(pi, win.document.documentElement);
    return pi;
  },

  injectLocalization(win) {
    try {
      win.MozXULElement.insertFTLIfNeeded("ai4zotero.ftl");
    } catch (e) {
      Zotero.debug(`AI4Zotero: failed to inject localization: ${e}`);
    }
  },

  createToolsMenuItem(win) {
    let doc = win.document;
    let popup = doc.getElementById("menu_ToolsPopup");
    if (!popup) {
      return null;
    }
    let item = doc.createXULElement("menuitem");
    item.id = "ai4zotero-tools-menuitem";
    item.setAttribute("label", "AI4Zotero Settings");
    item.addEventListener("command", () => this.showPanel(win, { focus: "settings" }));

    let pluginsItem = doc.getElementById("menu_addons");
    if (pluginsItem?.parentNode === popup) {
      popup.insertBefore(item, pluginsItem);
    } else {
      popup.appendChild(item);
    }
    return item;
  },

  registerItemPaneSection() {
    if (!Zotero.ItemPaneManager?.registerSection || this.registeredPaneID) {
      return;
    }

    let icon16 = this.getIconDataURI(16);
    let icon20 = this.getIconDataURI(20);
    this.registeredPaneID = Zotero.ItemPaneManager.registerSection({
      paneID: this.paneID,
      pluginID: this.id,
      header: {
        l10nID: "ai4zotero-section-header",
        icon: icon16
      },
      sidenav: {
        l10nID: "ai4zotero-section-sidenav",
        icon: icon20,
        orderable: true
      },
      onItemChange: ({ item, setEnabled, setSectionSummary }) => {
        let enabled = !!item && typeof item.isNote === "function" && !item.isNote();
        setEnabled(enabled);
        setSectionSummary(this.getCharPref(this.prefs.apiKey, "") ? "Ready" : "API key required");
      },
      onRender: ({ doc, body }) => {
        body.replaceChildren();
        let win = doc.defaultView;
        let panel = this.createPanel(win, { embedded: true });
        panel.hidden = false;
        body.append(panel);
        this.refreshContextPreview(win).catch(e => this.reportError(win, e));
      },
      onToggle: ({ doc, body }) => {
        let win = doc.defaultView;
        let panel = body.querySelector("#ai4zotero-panel");
        if (panel) {
          this.populateSettings(panel);
          this.updateConfigStatus(panel);
          this.refreshContextPreview(win).catch(e => this.reportError(win, e));
        }
      }
    }) || "";
  },

  unregisterItemPaneSection() {
    if (!this.registeredPaneID || !Zotero.ItemPaneManager?.unregisterSection) {
      return;
    }
    Zotero.ItemPaneManager.unregisterSection(this.registeredPaneID);
    this.registeredPaneID = "";
  },

  getIconDataURI(size) {
    let stroke = "#2271b1";
    let svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20">`,
      `<rect x="2.5" y="2.5" width="15" height="15" rx="4" fill="none" stroke="${stroke}" stroke-width="1.8"/>`,
      `<path d="M6 14l1.2-3.2h5.6L14 14M8 8.8h4" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<path d="M9.9 4.9l.1-.4.1.4.4.1-.4.1-.1.4-.1-.4-.4-.1.4-.1z" fill="${stroke}"/>`,
      `</svg>`
    ].join("");
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  },

  createPanel(win, options = {}) {
    let { embedded = false } = options;
    let doc = win.document;
    let html = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    html.id = "ai4zotero-panel";
    html.setAttribute("hidden", "true");
    if (embedded) {
      html.classList.add("ai4zotero-embedded");
    }
    html.innerHTML = `
      <div class="zda-header">
        <div>
          <div class="zda-title">AI4Zotero</div>
          <div class="zda-subtitle" data-role="source">Open a PDF or select an attachment</div>
        </div>
        <button type="button" class="zda-icon-button" data-action="close" title="Close">×</button>
      </div>
      <div class="zda-status" data-role="config-status"></div>
      <details class="zda-settings" data-role="settings" open>
        <summary>DeepSeek API Settings</summary>
        <label>API Key
          <input type="password" data-field="apiKey" placeholder="sk-..." autocomplete="off" />
        </label>
        <label>Endpoint
          <input type="url" data-field="endpoint" />
        </label>
        <label>Model
          <input type="text" data-field="model" />
        </label>
        <div class="zda-settings-actions">
          <button type="button" data-action="save-settings">Save</button>
          <button type="button" data-action="test-api">Test</button>
        </div>
      </details>
      <div class="zda-quick-actions">
        <button type="button" data-prompt="summarize">Summarize</button>
        <button type="button" data-prompt="selection">Explain Selection</button>
        <button type="button" data-prompt="methods">Methods</button>
        <button type="button" data-prompt="limitations">Limitations</button>
      </div>
      <div class="zda-context">
        <div class="zda-section-title">Context</div>
        <textarea data-field="context" spellcheck="false"></textarea>
        <div class="zda-context-actions">
          <button type="button" data-action="refresh-context">Refresh</button>
          <button type="button" data-action="clear-context">Clear</button>
        </div>
      </div>
      <div class="zda-chat" data-role="chat"></div>
      <form class="zda-composer" data-role="composer">
        <textarea data-field="question" placeholder="Ask about this paper..." rows="4"></textarea>
        <button type="submit" data-action="ask">Ask</button>
      </form>
    `;

    html.querySelector('[data-action="close"]').addEventListener("click", () => {
      if (embedded) {
        let section = html.closest("item-pane-custom-section");
        if (section) {
          section.open = false;
        }
      } else {
        this.hidePanel(win);
      }
    });
    html.querySelector('[data-action="save-settings"]').addEventListener("click", () => this.saveSettings(win, true));
    html.querySelector('[data-action="test-api"]').addEventListener("click", () => {
      this.testConnection(win).catch(e => this.reportError(win, e));
    });
    html.querySelector('[data-action="refresh-context"]').addEventListener("click", () => {
      this.refreshContextPreview(win).catch(e => this.reportError(win, e));
    });
    html.querySelector('[data-action="clear-context"]').addEventListener("click", () => {
      html.querySelector('[data-field="context"]').value = "";
    });
    html.querySelector('[data-role="composer"]').addEventListener("submit", event => {
      event.preventDefault();
      this.ask(win).catch(e => this.reportError(win, e));
    });
    for (let quickButton of html.querySelectorAll("[data-prompt]")) {
      quickButton.addEventListener("click", event => {
        this.applyQuickPrompt(win, event.currentTarget.dataset.prompt);
      });
    }

    this.populateSettings(html);
    this.updateConfigStatus(html);
    return html;
  },

  populateSettings(panel) {
    panel.querySelector('[data-field="apiKey"]').value = this.getCharPref(this.prefs.apiKey, "");
    panel.querySelector('[data-field="endpoint"]').value = this.getCharPref(this.prefs.endpoint, this.defaults.endpoint);
    panel.querySelector('[data-field="model"]').value = this.getCharPref(this.prefs.model, this.defaults.model);
  },

  updateConfigStatus(panel) {
    let status = panel.querySelector('[data-role="config-status"]');
    if (!status) {
      return;
    }
    let hasKey = Boolean(this.getCharPref(this.prefs.apiKey, ""));
    let model = this.getCharPref(this.prefs.model, this.defaults.model);
    status.textContent = hasKey
      ? `DeepSeek configured. Model: ${model}`
      : "Set your DeepSeek API key here before asking questions.";
    status.classList.toggle("zda-status-ready", hasKey);
  },

  togglePanel(win, seed = {}) {
    this.showPanel(win, seed).catch(e => this.reportError(win, e));
  },

  async showPanel(win, seed = {}) {
    let panel = await this.openItemPaneSection(win);
    if (!panel) {
      throw new Error("AI4Zotero section is not available for the current Zotero view.");
    }
    panel.hidden = false;
    if (seed.context) {
      let contextField = panel.querySelector('[data-field="context"]');
      contextField.value = this.mergeContext(seed.context, contextField.value);
    }
    if (seed.question) {
      panel.querySelector('[data-field="question"]').value = seed.question;
    }
    await this.refreshContextPreview(win, seed.context);
    if (seed.focus === "settings" || !this.getCharPref(this.prefs.apiKey, "")) {
      panel.querySelector('[data-role="settings"]').open = true;
      panel.querySelector('[data-field="apiKey"]').focus();
    } else {
      panel.querySelector('[data-field="question"]').focus();
    }
  },

  async openItemPaneSection(win) {
    let doc = win.document;
    let paneID = this.registeredPaneID || this.paneID;
    let container = null;

    try {
      if (win.Zotero_Tabs?.selectedType === "library") {
        let itemPane = doc.getElementById("zotero-item-pane");
        if (itemPane) {
          itemPane.collapsed = false;
          itemPane.render?.();
        }
        container = doc.getElementById("zotero-view-item-sidenav")?.container;
      } else {
        if (win.ZoteroContextPane) {
          win.ZoteroContextPane.collapsed = false;
          win.ZoteroContextPane.context.mode = "item";
          win.ZoteroContextPane.update();
        }
        container = doc.getElementById("zotero-context-pane-sidenav")?.container;
      }

      if (!container) {
        await Zotero.Promise.delay(100);
        container = doc.getElementById("zotero-context-pane-sidenav")?.container
          || doc.getElementById("zotero-view-item-sidenav")?.container;
      }

      if (!container) {
        return null;
      }

      await container.render?.();
      await Zotero.Promise.delay(50);
      let pane = container.getPane?.(paneID);
      if (pane) {
        pane.open = true;
        pane.hidden = false;
      }
      container.sidenav?.addPane?.(paneID);
      container.sidenav?.updatePaneStatus?.(paneID);
      await container.scrollToPane?.(paneID, "smooth");
      return this.getPanel(win);
    } catch (e) {
      Zotero.debug(`AI4Zotero: failed to open item pane section: ${e}`);
      return this.getPanel(win);
    }
  },

  hidePanel(win) {
    let panel = this.getPanel(win);
    if (!panel) {
      return;
    }
    panel.hidden = true;
  },

  getPanel(win) {
    return this.windows.get(win)?.panel || win.document.getElementById("ai4zotero-panel");
  },

  saveSettings(win, announce = false) {
    let panel = this.getPanel(win);
    this.setCharPref(this.prefs.apiKey, panel.querySelector('[data-field="apiKey"]').value.trim());
    this.setCharPref(this.prefs.endpoint, panel.querySelector('[data-field="endpoint"]').value.trim() || this.defaults.endpoint);
    this.setCharPref(this.prefs.model, panel.querySelector('[data-field="model"]').value.trim() || this.defaults.model);
    this.updateConfigStatus(panel);
    if (announce) {
      this.addMessage(win, "system", "Settings saved locally in Zotero preferences.");
    }
  },

  applyQuickPrompt(win, type) {
    let prompts = {
      summarize: "Summarize this paper in 6 bullet points, then list the main contribution and key evidence.",
      selection: "Explain the selected text in plain language and relate it to the paper's main argument.",
      methods: "Explain the method section: what problem is solved, what components are introduced, and how evaluation is designed.",
      limitations: "Identify the likely limitations, assumptions, and possible follow-up experiments for this paper."
    };
    let panel = this.getPanel(win);
    panel.querySelector('[data-field="question"]').value = prompts[type] || prompts.summarize;
    this.refreshContextPreview(win).catch(e => this.reportError(win, e));
    panel.querySelector('[data-field="question"]').focus();
  },

  async refreshContextPreview(win, seedContext = "") {
    let panel = this.getPanel(win);
    if (!panel) {
      return;
    }
    let context = seedContext || await this.getCurrentContext(win);
    let field = panel.querySelector('[data-field="context"]');
    if (!field.value.trim() || seedContext) {
      field.value = this.mergeContext(context, field.value);
    }

    let reader = this.getActiveReader(win);
    let item = reader?.itemID ? Zotero.Items.get(reader.itemID) : this.getSelectedAttachment(win);
    let title = await this.getDisplayTitle(item);
    panel.querySelector('[data-role="source"]').textContent = title || "No reader detected";
  },

  mergeContext(newContext, oldContext) {
    let cleanNew = (newContext || "").trim();
    let cleanOld = (oldContext || "").trim();
    if (!cleanNew) {
      return cleanOld;
    }
    if (!cleanOld) {
      return cleanNew;
    }
    if (cleanOld.includes(cleanNew)) {
      return cleanOld;
    }
    return `${cleanNew}\n\n${cleanOld}`;
  },

  async getCurrentContext(win) {
    let parts = [];
    let reader = this.getActiveReader(win);
    let item = reader?.itemID ? Zotero.Items.get(reader.itemID) : this.getSelectedAttachment(win);

    if (item) {
      let title = await this.getDisplayTitle(item);
      if (title) {
        parts.push(`Title: ${title}`);
      }
      let parent = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
      if (parent) {
        let creators = parent.getCreatorsJSON?.()
          ?.map(c => [c.firstName, c.lastName].filter(Boolean).join(" "))
          .filter(Boolean)
          .join(", ");
        if (creators) {
          parts.push(`Authors: ${creators}`);
        }
        let abstractNote = parent.getField("abstractNote");
        if (abstractNote) {
          parts.push(`Abstract: ${abstractNote}`);
        }
      }
    }

    let selectedText = this.getReaderSelection(reader);
    if (selectedText) {
      parts.push(`Selected text:\n${selectedText}`);
    }

    let annotations = await this.getRecentAnnotations(item);
    if (annotations) {
      parts.push(`Recent annotations:\n${annotations}`);
    }

    let indexedText = await this.getIndexedAttachmentText(item);
    if (indexedText) {
      parts.push(`Indexed attachment text:\n${indexedText}`);
    }

    let maxChars = this.getIntPref(this.prefs.maxContextChars, this.defaults.maxContextChars);
    return parts.join("\n\n").slice(0, maxChars);
  },

  getActiveReader(win) {
    try {
      let tabID = win.Zotero_Tabs?.selectedID;
      return tabID ? Zotero.Reader.getByTabID(tabID) : null;
    } catch (e) {
      return null;
    }
  },

  getSelectedAttachment(win) {
    try {
      let selected = win.ZoteroPane?.getSelectedItems?.() || [];
      return selected.find(item => item.isAttachment?.()) || null;
    } catch (e) {
      return null;
    }
  },

  getReaderSelection(reader) {
    try {
      let selection = reader?._iframeWindow?.getSelection?.();
      let text = selection?.toString?.().trim();
      return text || "";
    } catch (e) {
      return "";
    }
  },

  async getRecentAnnotations(item) {
    if (!item?.getAnnotations) {
      return "";
    }
    try {
      let annotations = item.getAnnotations()
        .slice(-8)
        .map(annotation => {
          let text = annotation.annotationText || annotation.getField?.("annotationText") || "";
          let comment = annotation.annotationComment || annotation.getField?.("annotationComment") || "";
          return [text, comment && `Comment: ${comment}`].filter(Boolean).join("\n");
        })
        .filter(Boolean);
      return annotations.join("\n\n");
    } catch (e) {
      return "";
    }
  },

  async getIndexedAttachmentText(item) {
    if (!item?.isAttachment?.()) {
      return "";
    }
    try {
      let cacheFile = Zotero.Fulltext.getItemCacheFile(item);
      let text = await Zotero.File.getContentsAsync(cacheFile, "UTF-8");
      return (text || "").trim();
    } catch (e) {
      Zotero.debug(`DeepSeek Assistant: full-text lookup failed: ${e}`);
      return "";
    }
  },

  async getDisplayTitle(item) {
    if (!item) {
      return "";
    }
    try {
      let parent = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
      return parent?.getField("title") || item.getField("title") || item.attachmentFilename || "";
    } catch (e) {
      return "";
    }
  },

  async ask(win) {
    let panel = this.getPanel(win);
    this.saveSettings(win);
    let questionField = panel.querySelector('[data-field="question"]');
    let question = questionField.value.trim();
    if (!question) {
      return;
    }

    let apiKey = this.getCharPref(this.prefs.apiKey, "");
    if (!apiKey) {
      this.addMessage(win, "system", "Please set your DeepSeek API key first.");
      panel.querySelector('[data-role="settings"]').open = true;
      panel.querySelector('[data-field="apiKey"]').focus();
      return;
    }

    let context = panel.querySelector('[data-field="context"]').value.trim() || await this.getCurrentContext(win);
    let payload = {
      model: this.getCharPref(this.prefs.model, this.defaults.model),
      messages: [
        { role: "system", content: this.getCharPref(this.prefs.systemPrompt, this.defaults.systemPrompt) },
        {
          role: "user",
          content:
            `Paper context:\n${context || "(No context available)"}\n\n` +
            `Question:\n${question}`
        }
      ],
      temperature: 0.2,
      stream: false
    };

    this.addMessage(win, "user", question);
    questionField.value = "";
    let pending = this.addMessage(win, "assistant", "Thinking...");

    try {
      let answer = await this.callDeepSeek(payload, apiKey);
      pending.textContent = answer;
    } catch (e) {
      pending.textContent = `Request failed: ${e.message || e}`;
    }
  },

  async testConnection(win) {
    let panel = this.getPanel(win);
    this.saveSettings(win);
    let apiKey = this.getCharPref(this.prefs.apiKey, "");
    if (!apiKey) {
      this.addMessage(win, "system", "Please set your DeepSeek API key first.");
      panel.querySelector('[data-field="apiKey"]').focus();
      return;
    }

    let pending = this.addMessage(win, "system", "Testing DeepSeek connection...");
    let payload = {
      model: this.getCharPref(this.prefs.model, this.defaults.model),
      messages: [
        { role: "system", content: "Reply with exactly: OK" },
        { role: "user", content: "Connection test" }
      ],
      temperature: 0,
      stream: false
    };
    let answer = await this.callDeepSeek(payload, apiKey);
    pending.textContent = `Connection OK. Response: ${answer}`;
  },

  async callDeepSeek(payload, apiKey) {
    let endpoint = this.getCharPref(this.prefs.endpoint, this.defaults.endpoint);
    let xhr = await Zotero.HTTP.request("POST", endpoint, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      responseType: "json"
    });

    let response = xhr.response || JSON.parse(xhr.responseText || "{}");
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(response?.error?.message || `HTTP ${xhr.status}`);
    }
    let content = response?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("DeepSeek returned an empty response.");
    }
    return content.trim();
  },

  addMessage(win, role, text) {
    let panel = this.getPanel(win);
    if (!panel) {
      Zotero.debug(`AI4Zotero ${role}: ${text}`);
      return null;
    }
    let chat = panel.querySelector('[data-role="chat"]');
    let message = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    message.className = `zda-message zda-${role}`;
    message.textContent = text;
    chat.appendChild(message);
    chat.scrollTop = chat.scrollHeight;
    return message;
  },

  reportError(win, error) {
    Zotero.debug(`DeepSeek Assistant: ${error?.stack || error}`);
    this.addMessage(win, "system", error?.message || String(error));
  },

  registerReaderHooks() {
    if (!Zotero.Reader?.registerEventListener) {
      return;
    }

    let toolbarHandler = event => {
      let { reader, doc, append } = event;
      let button = doc.createElement("button");
      button.className = "ai4zotero-reader-toolbar-button";
      button.type = "button";
      button.textContent = "AI";
      button.title = "Open AI4Zotero";
      button.style.cssText = [
        "height: 28px",
        "min-width: 32px",
        "padding: 0 8px",
        "border: 1px solid rgba(0,0,0,.22)",
        "border-radius: 6px",
        "background: #fff",
        "color: #1f2328",
        "font: menu",
        "font-weight: 600"
      ].join(";");
      button.addEventListener("click", () => {
        this.showPanel(reader._window, { focus: "question" });
      });
      append(button);
    };

    let selectionHandler = event => {
      let { reader, doc, params, append } = event;
      let button = doc.createElement("button");
      button.className = "ai4zotero-selection-button";
      button.textContent = "Ask AI";
      button.style.cssText = "margin-left:4px;padding:3px 8px;border-radius:6px;border:1px solid rgba(0,0,0,.22);background:#fff;color:#1f2328;font:menu;";
      button.addEventListener("click", () => {
        let text = params?.annotation?.text || params?.text || "";
        this.showPanel(reader._window, { context: text ? `Selected text:\n${text}` : "" });
      });
      append(button);
    };

    let annotationMenuHandler = event => {
      let { reader, params, append } = event;
      append({
        label: "Ask DeepSeek about selection",
        onCommand: () => {
          let context = this.getAnnotationContextFromIDs(reader, params?.ids || []);
          this.showPanel(reader._window, { context });
        }
      });
    };

    Zotero.Reader.registerEventListener("renderToolbar", toolbarHandler, this.id);
    Zotero.Reader.registerEventListener("renderTextSelectionPopup", selectionHandler, this.id);
    Zotero.Reader.registerEventListener("createAnnotationContextMenu", annotationMenuHandler, this.id);
    this.readerHandlers = [
      ["renderToolbar", toolbarHandler],
      ["renderTextSelectionPopup", selectionHandler],
      ["createAnnotationContextMenu", annotationMenuHandler]
    ];
  },

  unregisterReaderHooks() {
    if (Zotero.Reader?.unregisterEventListener) {
      for (let [type, handler] of this.readerHandlers) {
        Zotero.Reader.unregisterEventListener(type, handler);
      }
    }
    this.readerHandlers = [];
  },

  getAnnotationContextFromIDs(reader, ids) {
    try {
      let attachment = Zotero.Items.get(reader.itemID);
      let selected = attachment.getAnnotations()
        .filter(annotation => ids.includes(annotation.key))
        .map(annotation => {
          let text = annotation.annotationText || "";
          let comment = annotation.annotationComment || "";
          return [text, comment && `Comment: ${comment}`].filter(Boolean).join("\n");
        })
        .filter(Boolean);
      return selected.length ? `Selected annotations:\n${selected.join("\n\n")}` : "";
    } catch (e) {
      Zotero.debug(`DeepSeek Assistant: annotation context failed: ${e}`);
      return "";
    }
  },

  getCharPref(name, fallback) {
    try {
      return Services.prefs.getCharPref(name);
    } catch (e) {
      return fallback;
    }
  },

  setCharPref(name, value) {
    Services.prefs.setCharPref(name, value);
  },

  getIntPref(name, fallback) {
    try {
      return Services.prefs.getIntPref(name);
    } catch (e) {
      return fallback;
    }
  }
};

function install() {}

function uninstall() {}

function startup(data, reason) {
  DeepSeekAssistant.startup(data, reason);
}

function shutdown(data, reason) {
  if (typeof APP_SHUTDOWN !== "undefined" && reason === APP_SHUTDOWN) {
    return;
  }
  DeepSeekAssistant.shutdown(data, reason);
}

function onMainWindowLoad({ window }) {
  DeepSeekAssistant.loadWindow(window);
}

function onMainWindowUnload({ window }) {
  DeepSeekAssistant.unloadWindow(window);
}
