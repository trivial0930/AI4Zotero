/* global Zotero, Services */

var chromeHandle;

var DeepSeekAssistant = {
  id: "ai4zotero@trivial0930.github.io",
  appName: "AI4Zotero",
  paneID: "ai4zotero",
  registeredPaneID: "",
  rootURI: "",
  windows: new Map(),
  readerWindows: new Map(),
  readerHandlers: [],
  suppressAutoOpenUntil: 0,
  contextTimers: new WeakMap(),
  prefs: {
    apiKey: "extensions.ai4zotero.apiKey",
    endpoint: "extensions.ai4zotero.endpoint",
    model: "extensions.ai4zotero.model",
    systemPrompt: "extensions.ai4zotero.systemPrompt",
    maxContextChars: "extensions.ai4zotero.maxContextChars",
    fontSize: "extensions.ai4zotero.fontSize",
    reasoningEffort: "extensions.ai4zotero.reasoningEffort",
    languageStyle: "extensions.ai4zotero.languageStyle"
  },
  defaults: {
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    systemPrompt:
      "你是一个严谨的中文学术阅读助手。优先使用中文回答，除非用户明确要求其他语言。" +
      "请基于提供的论文上下文作答，必要时简要引用关键片段；如果上下文不足，请明确说明。",
    maxContextChars: 14000,
    fontSize: "medium",
    reasoningEffort: "balanced",
    languageStyle: "academic"
  },

  async startup(data) {
    this.id = data.id || this.id;
    await Zotero.initializationPromise;
    this.rootURI = data.rootURI || data.resourceURI?.spec || "";
    Zotero.debug("AI4Zotero: startup");
    this.registerChrome();
    this.ensureDefaultPrefs();
    this.registerItemPaneSection();
    this.registerReaderHooks();
    this.loadExistingWindows();
  },

  shutdown() {
    Zotero.debug("AI4Zotero: shutdown");
    this.unregisterReaderHooks();
    this.unregisterItemPaneSection();
    for (let win of this.windows.keys()) {
      this.unloadWindow(win);
    }
    for (let win of this.readerWindows.keys()) {
      this.unloadStandaloneReaderWindow(win);
    }
    this.windows.clear();
    this.readerWindows.clear();
    if (chromeHandle) {
      chromeHandle.destruct();
      chromeHandle = null;
    }
  },

  registerChrome() {
    if (chromeHandle || !this.rootURI) {
      return;
    }
    let aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
      .getService(Components.interfaces.amIAddonManagerStartup);
    let manifestURI = Services.io.newURI(this.rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "ai4zotero", this.rootURI + "chrome/content/"]
    ]);
    Zotero.debug("AI4Zotero: chrome registered");
  },

  loadExistingWindows() {
    try {
      let enumerator = Services.wm.getEnumerator("navigator:browser");
      while (enumerator.hasMoreElements()) {
        let win = enumerator.getNext();
        if (win?.document?.readyState === "complete") {
          this.loadWindow(win);
        } else if (win?.addEventListener) {
          win.addEventListener("load", () => this.loadWindow(win), { once: true });
        }
      }
      let readerEnumerator = Services.wm.getEnumerator("zotero:reader");
      while (readerEnumerator.hasMoreElements()) {
        let win = readerEnumerator.getNext();
        if (win?.document?.readyState === "complete") {
          this.loadStandaloneReaderWindow(win);
        } else if (win?.addEventListener) {
          win.addEventListener("load", () => this.loadStandaloneReaderWindow(win), { once: true });
        }
      }
      Zotero.debug(`AI4Zotero: loaded existing windows (${this.windows.size})`);
    } catch (e) {
      Zotero.debug(`AI4Zotero: failed loading existing windows: ${e}`);
    }
  },

  ensureDefaultPrefs() {
    this.setDefaultCharPref(this.prefs.endpoint, this.defaults.endpoint);
    this.setDefaultCharPref(this.prefs.model, this.defaults.model);
    this.setDefaultCharPref(this.prefs.systemPrompt, this.defaults.systemPrompt);
    this.setDefaultCharPref(this.prefs.fontSize, this.defaults.fontSize);
    this.setDefaultCharPref(this.prefs.reasoningEffort, this.defaults.reasoningEffort);
    this.setDefaultCharPref(this.prefs.languageStyle, this.defaults.languageStyle);
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
    Zotero.debug("AI4Zotero: main window loaded");

    let doc = win.document;
    let button = doc.createXULElement("toolbarbutton");
    button.id = "ai4zotero-toolbar-button";
    button.className = "zotero-tb-button";
    button.setAttribute("label", "AI4Zotero");
    button.setAttribute("tooltiptext", "打开 AI4Zotero");
    button.addEventListener("command", () => this.togglePanel(win, { focus: "question" }));

    let toolbar = doc.getElementById("zotero-tabs-toolbar") || doc.getElementById("zotero-toolbar");
    if (toolbar) {
      toolbar.appendChild(button);
    }

    let menuitem = this.createToolsMenuItem(win);
    let contextButton = this.createContextPaneButton(win);
    let sideNavHandler = event => {
      if (event?.target?.closest?.("#ai4zotero-docked-panel, #ai4zotero-panel, #ai4zotero-context-button")) {
        return;
      }
      let panel = this.getPanel(win);
      if (panel && this.isPanelVisible(panel)) {
        this.queueAutoContextRefresh(win, panel, 250);
      }
      Zotero.Promise.delay(80).then(() => {
        this.openDockedPanelIfSelected(win).catch(e => this.reportError(win, e));
      });
    };
    doc.addEventListener("click", sideNavHandler, true);

    let state = { button, menuitem, contextButton, stylesheet, sideNavHandler };
    this.windows.set(win, state);
    this.refreshItemPaneSections(win);
  },

  unloadWindow(win) {
    let state = this.windows.get(win);
    if (!state) {
      return;
    }
    win.document.removeEventListener("click", state.sideNavHandler, true);
    state.button?.remove();
    state.menuitem?.remove();
    state.contextButton?.remove();
    state.stylesheet?.remove();
    win.document.querySelector('[href="ai4zotero.ftl"]')?.remove();
    this.windows.delete(win);
  },

  loadStandaloneReaderWindow(win) {
    if (this.readerWindows.has(win) || !win?.document) {
      return;
    }

    let stylesheet = this.injectStylesheet(win);
    let doc = win.document;
    let host = doc.getElementById("zotero-reader")?.parentElement;
    if (!host) {
      Zotero.debug("AI4Zotero: standalone reader host unavailable");
      return;
    }

    let rail = doc.createXULElement("vbox");
    rail.id = "ai4zotero-reader-rail";
    rail.setAttribute("pack", "start");
    let button = doc.createXULElement("toolbarbutton");
    button.id = "ai4zotero-reader-rail-button";
    button.setAttribute("label", "AI");
    button.setAttribute("tooltiptext", "AI4Zotero");
    button.addEventListener("command", () => this.showPanel(win, { focus: "question" }));
    rail.append(button);

    let box = doc.createXULElement("vbox");
    box.id = "ai4zotero-reader-panel-box";
    box.setAttribute("hidden", "true");
    let panel = this.createPanel(win, { standaloneReader: true });
    panel.hidden = false;
    box.append(panel);
    host.append(rail, box);

    this.readerWindows.set(win, { stylesheet, rail, box, panel });
    win.addEventListener("unload", () => this.unloadStandaloneReaderWindow(win), { once: true });
    Zotero.debug("AI4Zotero: standalone reader window loaded");
  },

  unloadStandaloneReaderWindow(win) {
    let state = this.readerWindows.get(win);
    if (!state) {
      return;
    }
    state.rail?.remove();
    state.box?.remove();
    state.stylesheet?.remove();
    this.readerWindows.delete(win);
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
    item.setAttribute("label", "AI4Zotero 设置");
    item.addEventListener("command", () => this.showPanel(win, { focus: "settings" }));

    let pluginsItem = doc.getElementById("menu_addons");
    if (pluginsItem?.parentNode === popup) {
      popup.insertBefore(item, pluginsItem);
    } else {
      popup.appendChild(item);
    }
    return item;
  },

  createContextPaneButton(win) {
    let doc = win.document;
    let host = doc.getElementById("zotero-context-pane-inner")
      || doc.getElementById("zotero-context-pane")
      || doc.getElementById("zotero-item-pane");
    if (!host || doc.getElementById("ai4zotero-context-button")) {
      return null;
    }
    let button = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    button.id = "ai4zotero-context-button";
    button.type = "button";
    button.setAttribute("aria-label", "打开 AI4Zotero");
    button.title = "打开 AI4Zotero";
    let icon = doc.createElementNS("http://www.w3.org/1999/xhtml", "img");
    icon.className = "ai4zotero-context-button-icon";
    icon.src = "chrome://ai4zotero/content/icons/app-icon.png";
    icon.alt = "";
    button.append(icon);
    let open = event => {
      event.preventDefault();
      event.stopPropagation();
      this.showPanel(win, { focus: "question" }).catch(e => this.reportError(win, e));
    };
    button.addEventListener("click", open);
    button.addEventListener("mousedown", open);
    button.addEventListener("pointerup", open);
    host.append(button);
    return button;
  },

  refreshItemPaneSections(win) {
    try {
      for (let itemDetails of win.document.querySelectorAll("item-details")) {
        itemDetails.renderCustomSections?.();
        itemDetails.forceUpdateSideNav?.();
        this.forceOpenRenderedSections(itemDetails);
      }
      win.ZoteroContextPane?.update?.();
      Zotero.debug("AI4Zotero: refreshed item pane sections");
    } catch (e) {
      Zotero.debug(`AI4Zotero: failed refreshing item pane sections: ${e}`);
    }
  },

  registerItemPaneSection() {
    if (!Zotero.ItemPaneManager?.registerSection || this.registeredPaneID) {
      Zotero.debug(`AI4Zotero: ItemPaneManager unavailable or already registered (${this.registeredPaneID})`);
      return;
    }

    let icon16 = "chrome://ai4zotero/content/icons/section-16.svg";
    let icon20 = "chrome://ai4zotero/content/icons/section-20.svg";
    let settingsIcon = "chrome://ai4zotero/content/icons/settings-16.svg";
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
      sectionButtons: [
        {
          type: "settings",
          icon: settingsIcon,
          l10nID: "ai4zotero-section-settings",
          onClick: ({ doc }) => {
            this.showPanel(doc.defaultView, { focus: "settings" })
              .catch(e => this.reportError(doc.defaultView, e));
          }
        }
      ],
      onItemChange: ({ item, setEnabled, setSectionSummary }) => {
        let enabled = !!item && typeof item.isNote === "function" && !item.isNote();
        setEnabled(enabled);
        setSectionSummary(this.getCharPref(this.prefs.apiKey, "") ? "已配置" : "需要 API Key");
      },
      onRender: ({ doc, body }) => {
        Zotero.debug("AI4Zotero: rendering item pane section");
        this.forceOpenSectionBody(body);
        body.replaceChildren();
        let win = doc.defaultView;
        let panel = this.createPanel(win, { embedded: true });
        panel.hidden = false;
        body.append(panel);
        this.forceOpenSectionBody(body);
        Zotero.debug(`AI4Zotero: panel rendered controls=${panel.querySelectorAll("button,input,textarea").length} children=${panel.children.length}`);
        this.refreshContextPreview(win, "", panel).catch(e => this.reportError(win, e, panel));
      },
      onToggle: ({ doc, body }) => {
        let win = doc.defaultView;
        Zotero.debug("AI4Zotero: item pane section toggled");
        this.forceOpenSectionBody(body);
        let panel = body.querySelector("#ai4zotero-panel");
        if (panel) {
          this.populateSettings(panel);
          this.updateConfigStatus(panel);
          this.refreshContextPreview(win, "", panel).catch(e => this.reportError(win, e, panel));
          Zotero.Promise.delay(80).then(() => {
            if (!this.isPanelVisible(panel)) {
              this.openDockedPanel(win).catch(e => this.reportError(win, e, panel));
            }
          });
        }
      }
    }) || "";
    Zotero.debug(`AI4Zotero: registered item pane section ${this.registeredPaneID}`);
    this.ensureItemPaneVisibilityPrefs();
  },

  forceOpenSectionBody(body) {
    let section = body?.closest?.("collapsible-section");
    let customSection = body?.closest?.("item-pane-custom-section");
    if (customSection) {
      customSection.hidden = false;
      customSection.removeAttribute("hidden");
      customSection.open = true;
      customSection.setAttribute("open", "true");
    }
    if (body) {
      body.hidden = false;
      body.removeAttribute("hidden");
      body.style.display = "block";
      body.style.visibility = "visible";
      body.style.minHeight = "540px";
      body.style.overflow = "visible";
    }
    if (!section) {
      return;
    }
    section.open = true;
    section.hidden = false;
    section.removeAttribute("hidden");
    section.toggleAttribute("open", true);
    section.setAttribute("open", "true");
    section.collapsible = false;
    section.style.setProperty("--open-height", "auto");
    section.style.minHeight = "560px";
    section.style.overflow = "visible";
    section.render?.();
  },

  forceOpenRenderedSections(root) {
    for (let body of root.querySelectorAll?.('item-pane-custom-section[data-pane] [data-type="body"]') || []) {
      if (body.querySelector("#ai4zotero-panel")) {
        this.forceOpenSectionBody(body);
      }
    }
  },

  ensureItemPaneVisibilityPrefs() {
    if (!this.registeredPaneID) {
      return;
    }
    try {
      Services.prefs.setBoolPref(`extensions.zotero.panes.${this.registeredPaneID}.open`, true);
      let order = Zotero.Prefs.get("sidenav.order") || "";
      let panes = order ? order.split(",").filter(Boolean) : [
        "info",
        "abstract",
        "attachments",
        "notes",
        "libraries-collections",
        "tags",
        "related"
      ];
      if (!panes.includes(this.registeredPaneID)) {
        panes.push(this.registeredPaneID);
        Zotero.Prefs.set("sidenav.order", panes.join(","));
      }
      Zotero.debug("AI4Zotero: ensured item pane visibility prefs");
    } catch (e) {
      Zotero.debug(`AI4Zotero: failed setting item pane visibility prefs: ${e}`);
    }
  },

  unregisterItemPaneSection() {
    if (!this.registeredPaneID || !Zotero.ItemPaneManager?.unregisterSection) {
      return;
    }
    Zotero.ItemPaneManager.unregisterSection(this.registeredPaneID);
    this.registeredPaneID = "";
  },

  createPanel(win, options = {}) {
    let { embedded = false, standaloneReader = false, docked = false } = options;
    let doc = win.document;
    let html = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    html.id = docked ? "ai4zotero-docked-panel" : "ai4zotero-panel";
    html.classList.add("ai4zotero-panel");
    html.setAttribute("hidden", "true");
    if (embedded) {
      html.classList.add("ai4zotero-embedded");
    }
    if (docked) {
      html.classList.add("ai4zotero-docked");
    }
    if (standaloneReader) {
      html.classList.add("ai4zotero-standalone-reader");
    }
    let h = (tag, attrs = {}, children = []) => {
      let elem = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      for (let [key, value] of Object.entries(attrs)) {
        if (key === "className") {
          elem.className = value;
        } else if (key === "text") {
          elem.textContent = value;
        } else if (key === "open" && value) {
          elem.setAttribute("open", "");
        } else if (value !== false && value !== null && typeof value !== "undefined") {
          elem.setAttribute(key, String(value));
        }
      }
      for (let child of children) {
        elem.append(child);
      }
      return elem;
    };
    let append = (parent, children = []) => {
      for (let child of children) {
        parent.appendChild(child);
      }
      return parent;
    };
    let button = (text, attrs = {}) => h("button", { type: "button", text, ...attrs });
    let input = (field, attrs = {}) => h("input", { "data-field": field, ...attrs });
    let select = (field, attrs = {}, options = []) => h(
      "select",
      { "data-field": field, ...attrs },
      options.map(option => h("option", { value: option.value, text: option.label }))
    );
    let label = (text, control) => h("label", {}, [doc.createTextNode(text), control]);
    let iconButton = (icon, attrs = {}) => {
      let elem = button("", { className: "zda-icon-button", ...attrs });
      elem.append(h("img", {
        className: "zda-button-icon",
        src: `chrome://ai4zotero/content/icons/ui-${icon}.svg`,
        alt: ""
      }));
      return elem;
    };
    let emptyState = () => h("div", { className: "zda-empty", "data-role": "empty" }, [
      h("div", { className: "zda-empty-spark", text: "✦" }),
      h("div", { className: "zda-empty-grid" }, [
        h("div", { className: "zda-empty-card" }, [
          h("div", { className: "zda-card-icon", text: "⌁" }),
          h("strong", { text: "划线并提问" }),
          h("p", { text: "选中论文任意段落后点击“问 AI”，让回答紧扣原文。" })
        ]),
        h("div", { className: "zda-empty-card" }, [
          h("div", { className: "zda-card-icon", text: "@" }),
          h("strong", { text: "自动同步文献" }),
          h("p", { text: "后台读取标题、摘要、批注和 Zotero 索引全文，不挤占提问空间。" })
        ]),
        h("div", { className: "zda-empty-card zda-empty-wide" }, [
          h("div", { className: "zda-card-icon", text: "+" }),
          h("strong", { text: "继续研究" }),
          h("p", { text: "让助手梳理贡献、局限、实验结果和可复现实验线索。" })
        ])
      ]),
      h("div", { className: "zda-empty-tip", text: "试着问：“第三节方法背后的直觉是什么？”" })
    ]);

    append(html, [
      h("div", { className: "zda-topbar" }, [
        iconButton("close", {
          className: "zda-icon-button zda-close-leading",
          "data-action": "close",
          title: "关闭",
          "aria-label": "关闭"
        }),
        iconButton("settings", {
          className: "zda-icon-button zda-settings-leading",
          "data-action": "toggle-settings",
          title: "DeepSeek 设置",
          "aria-label": "DeepSeek 设置"
        }),
        h("div", { className: "zda-title-group" }, [
          h("div", { className: "zda-title", text: "AI 阅读助手" }),
          h("div", {
            className: "zda-subtitle",
            "data-role": "source",
            text: "等待读取当前文献"
          })
        ])
      ]),
      h("div", { className: "zda-tabs", role: "tablist" }, [
        button("Assistant", { className: "zda-tab zda-tab-active", role: "tab", "aria-selected": "true" }),
        button("My Notes", { className: "zda-tab", role: "tab", disabled: true, title: "后续版本开放" }),
        button("Comments", { className: "zda-tab", role: "tab", disabled: true, title: "后续版本开放" }),
        button("Similar", { className: "zda-tab", role: "tab", disabled: true, title: "后续版本开放" })
      ]),
      h("div", { className: "zda-sessionbar" }, [
        button("＋ 新对话", { "data-action": "new-chat", className: "zda-session-button" }),
        button("↺ 历史", { className: "zda-session-button", disabled: true, title: "历史记录会在后续版本开放" })
      ]),
      h("div", { className: "zda-status", "data-role": "config-status" }),
      h("div", { className: "zda-settings", "data-role": "settings", hidden: true }, [
        h("div", { className: "zda-section-title", text: "DeepSeek API 设置" }),
        label("API Key", input("apiKey", { type: "password", placeholder: "sk-...", autocomplete: "off" })),
        label("接口地址", input("endpoint", { type: "url" })),
        label("模型", input("model", { type: "text" })),
        label("思考强度", select("reasoningEffort", {}, [
          { value: "fast", label: "快速" },
          { value: "balanced", label: "均衡" },
          { value: "deep", label: "深入" }
        ])),
        label("语言风格", select("languageStyle", {}, [
          { value: "academic", label: "学术严谨" },
          { value: "concise", label: "简洁直接" },
          { value: "teacher", label: "讲解式" },
          { value: "reviewer", label: "审稿人视角" }
        ])),
        label("阅读字号", select("fontSize", {}, [
          { value: "small", label: "紧凑" },
          { value: "medium", label: "标准" },
          { value: "large", label: "舒适" }
        ])),
        h("div", { className: "zda-settings-actions" }, [
          button("保存", { "data-action": "save-settings" }),
          button("测试连接", { "data-action": "test-api" })
        ])
      ]),
      h("div", { className: "zda-prompt-strip" }, [
        button("论文速览", { "data-prompt": "summarize" }),
        button("研究问题", { "data-prompt": "problem" }),
        button("方法拆解", { "data-prompt": "methods" }),
        button("实验结果", { "data-prompt": "results" }),
        button("解释划线", { "data-prompt": "selection" })
      ]),
      h("div", { className: "zda-chat", "data-role": "chat" }, [
        emptyState()
      ]),
      h("form", { className: "zda-composer", "data-role": "composer" }, [
        h("textarea", {
          "data-field": "question",
          placeholder: "询问这篇论文，或解释当前划线内容...",
          rows: "3"
        }),
        h("input", {
          type: "file",
          hidden: true,
          multiple: true,
          accept: "image/*,.txt,.md,.csv,.json,.pdf",
          "data-field": "fileInput"
        }),
        h("div", { className: "zda-attachments", "data-role": "attachments" }),
        h("div", { className: "zda-composer-footer" }, [
          h("div", { className: "zda-mode-chips" }, [
            button("📎", { className: "zda-attach-button", "data-action": "attach-file", title: "插入图片或上传文件", "aria-label": "插入图片或上传文件" }),
            select("composerReasoning", { className: "zda-mode-select", title: "思考强度" }, [
              { value: "fast", label: "快速" },
              { value: "balanced", label: "均衡" },
              { value: "deep", label: "深入" }
            ]),
            h("span", { className: "zda-mode-chip zda-mode-chip-accent", text: "Search" }),
            select("composerStyle", { className: "zda-mode-select", title: "语言风格" }, [
              { value: "academic", label: "学术" },
              { value: "concise", label: "简洁" },
              { value: "teacher", label: "讲解" },
              { value: "reviewer", label: "审稿" }
            ])
          ]),
          button("↑", {
            type: "submit",
            className: "zda-ask-button",
            "data-action": "ask",
            title: "发送问题",
            "aria-label": "发送问题"
          })
        ])
      ])
    ]);

    html.querySelector('[data-action="close"]').addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      this.closePanel(win, html);
    });
    html.querySelector('[data-action="toggle-settings"]').addEventListener("click", () => {
      this.toggleSettings(html);
    });
    html.querySelector('[data-action="save-settings"]').addEventListener("click", () => {
      try {
        this.saveSettings(win, true, html);
      } catch (e) {
        this.reportError(win, e, html);
      }
    });
    html.querySelector('[data-action="test-api"]').addEventListener("click", () => {
      this.testConnection(win, html).catch(e => this.reportError(win, e, html));
    });
    html.querySelector('[data-action="new-chat"]').addEventListener("click", () => {
      this.resetChat(win, html);
    });
    html.querySelector('[data-field="fontSize"]').addEventListener("change", () => {
      try {
        this.saveSettings(win, false, html);
      } catch (e) {
        this.reportError(win, e, html);
      }
    });
    html.querySelector('[data-field="composerReasoning"]').addEventListener("change", event => {
      this.setCharPref(this.prefs.reasoningEffort, event.currentTarget.value);
      this.populateSettings(html);
    });
    html.querySelector('[data-field="composerStyle"]').addEventListener("change", event => {
      this.setCharPref(this.prefs.languageStyle, event.currentTarget.value);
      this.populateSettings(html);
    });
    html.querySelector('[data-action="attach-file"]').addEventListener("click", event => {
      event.preventDefault();
      html.querySelector('[data-field="fileInput"]').click();
    });
    html.querySelector('[data-field="fileInput"]').addEventListener("change", event => {
      this.addFilesToPanel(win, html, Array.from(event.currentTarget.files || []))
        .catch(e => this.reportError(win, e, html));
      event.currentTarget.value = "";
    });
    html.querySelector('[data-field="question"]').addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
        return;
      }
      event.preventDefault();
      let composer = html.querySelector('[data-role="composer"]');
      if (typeof composer.requestSubmit === "function") {
        composer.requestSubmit();
      } else {
        composer.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      }
    });
    html.querySelector('[data-role="composer"]').addEventListener("submit", event => {
      event.preventDefault();
      this.ask(win, html).catch(e => this.reportError(win, e, html));
    });
    for (let quickButton of html.querySelectorAll("[data-prompt]")) {
      quickButton.addEventListener("click", event => {
        this.applyQuickPrompt(win, event.currentTarget.dataset.prompt, html);
      });
    }

    this.populateSettings(html);
    this.applyFontSize(html);
    this.updateConfigStatus(html);
    this.queueAutoContextRefresh(win, html, 300);
    if (embedded || docked || standaloneReader) {
      this.setContextButtonHidden(win, true);
    }
    this.toggleSettings(html, !this.getCharPref(this.prefs.apiKey, ""));
    return html;
  },

  populateSettings(panel) {
    panel.querySelector('[data-field="apiKey"]').value = this.getCharPref(this.prefs.apiKey, "");
    panel.querySelector('[data-field="endpoint"]').value = this.getCharPref(this.prefs.endpoint, this.defaults.endpoint);
    panel.querySelector('[data-field="model"]').value = this.getCharPref(this.prefs.model, this.defaults.model);
    panel.querySelector('[data-field="fontSize"]').value = this.getCharPref(this.prefs.fontSize, this.defaults.fontSize);
    panel.querySelector('[data-field="reasoningEffort"]').value = this.getCharPref(this.prefs.reasoningEffort, this.defaults.reasoningEffort);
    panel.querySelector('[data-field="languageStyle"]').value = this.getCharPref(this.prefs.languageStyle, this.defaults.languageStyle);
    panel.querySelector('[data-field="composerReasoning"]').value = this.getCharPref(this.prefs.reasoningEffort, this.defaults.reasoningEffort);
    panel.querySelector('[data-field="composerStyle"]').value = this.getCharPref(this.prefs.languageStyle, this.defaults.languageStyle);
  },

  updateConfigStatus(panel) {
    let status = panel.querySelector('[data-role="config-status"]');
    if (!status) {
      return;
    }
    let hasKey = Boolean(this.getCharPref(this.prefs.apiKey, ""));
    let model = this.getCharPref(this.prefs.model, this.defaults.model);
    status.hidden = hasKey;
    status.textContent = hasKey ? "" : "请先填写 DeepSeek API Key，然后就可以向当前文献提问。";
    status.title = hasKey ? `DeepSeek 已配置，当前模型：${model}` : "";
    status.classList.toggle("zda-status-ready", hasKey);
  },

  applyFontSize(panel) {
    let size = this.getCharPref(this.prefs.fontSize, this.defaults.fontSize);
    if (!["small", "medium", "large"].includes(size)) {
      size = this.defaults.fontSize;
    }
    panel.classList.remove("zda-font-small", "zda-font-medium", "zda-font-large");
    panel.classList.add(`zda-font-${size}`);
  },

  resetChat(win, panel = this.getPanel(win)) {
    if (!panel) {
      return;
    }
    let chat = panel.querySelector('[data-role="chat"]');
    chat.replaceChildren();
    let doc = win.document;
    let h = (tag, className, text = "") => {
      let elem = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (className) {
        elem.className = className;
      }
      if (text) {
        elem.textContent = text;
      }
      return elem;
    };
    let card = (icon, title, text, extraClass = "") => {
      let elem = h("div", `zda-empty-card${extraClass}`);
      elem.append(h("div", "zda-card-icon", icon), h("strong", "", title), h("p", "", text));
      return elem;
    };
    let empty = h("div", "zda-empty");
    empty.setAttribute("data-role", "empty");
    let grid = h("div", "zda-empty-grid");
    grid.append(
      card("⌁", "划线并提问", "选中论文任意段落后点击“问 AI”，让回答紧扣原文。"),
      card("@", "自动同步文献", "后台读取标题、摘要、批注和 Zotero 索引全文，不挤占提问空间。"),
      card("+", "继续研究", "让助手梳理贡献、局限、实验结果和可复现实验线索。", " zda-empty-wide")
    );
    empty.append(
      h("div", "zda-empty-spark", "✦"),
      grid,
      h("div", "zda-empty-tip", "试着问：“第三节方法背后的直觉是什么？”")
    );
    chat.append(empty);
    panel.querySelector('[data-field="question"]').value = "";
  },

  toggleSettings(panel, forceOpen = undefined) {
    let settings = panel.querySelector('[data-role="settings"]');
    if (!settings) {
      return;
    }
    let open = typeof forceOpen === "boolean" ? forceOpen : settings.hidden;
    settings.hidden = !open;
    panel.querySelector('[data-action="toggle-settings"]')?.classList.toggle("zda-active", open);
  },

  togglePanel(win, seed = {}) {
    this.showPanel(win, seed).catch(e => this.reportError(win, e));
  },

  async showPanel(win, seed = {}) {
    let panel = await this.openItemPaneSection(win);
    if (panel && !this.isPanelVisible(panel)) {
      panel = await this.openDockedPanel(win);
    }
    if (!panel) {
      panel = await this.openStandaloneReaderPanel(win);
    }
    if (!panel) {
      panel = await this.openDockedPanel(win);
    }
    if (!panel) {
      throw new Error("当前 Zotero 视图中无法打开 AI4Zotero 面板。");
    }
    panel.hidden = false;
    this.setContextButtonHidden(win, true);
    if (seed.context) {
      panel._ai4zoteroContext = this.mergeContext(seed.context, panel._ai4zoteroContext || "");
    }
    if (seed.question) {
      panel.querySelector('[data-field="question"]').value = seed.question;
    }
    await this.refreshContextPreview(win, seed.context, panel);
    if (seed.focus === "settings" || !this.getCharPref(this.prefs.apiKey, "")) {
      this.toggleSettings(panel, true);
      panel.querySelector('[data-field="apiKey"]').focus();
    } else {
      panel.querySelector('[data-field="question"]').focus();
    }
  },

  async openItemPaneSection(win) {
    let doc = win.document;
    let paneID = this.registeredPaneID || this.paneID;
    let itemDetails = null;

    try {
      if (win.Zotero_Tabs?.selectedType === "library") {
        let itemPane = doc.getElementById("zotero-item-pane");
        if (itemPane) {
          itemPane.collapsed = false;
          await itemPane.render?.();
        }
        itemDetails = doc.getElementById("zotero-item-details");
      } else {
        if (win.ZoteroContextPane) {
          win.ZoteroContextPane.collapsed = false;
          win.ZoteroContextPane.context.mode = "item";
          win.ZoteroContextPane.update();
        }
        itemDetails = this.getContextItemDetails(win);
      }

      for (let i = 0; !itemDetails && i < 10; i++) {
        await Zotero.Promise.delay(100);
        itemDetails = win.Zotero_Tabs?.selectedType === "library"
          ? doc.getElementById("zotero-item-details")
          : this.getContextItemDetails(win);
      }

      if (!itemDetails) {
        return null;
      }

      itemDetails.renderCustomSections?.();
      await itemDetails.render?.();
      await Zotero.Promise.delay(50);
      itemDetails.sidenav?.render?.();
      itemDetails.sidenav?.addPane?.(paneID);
      itemDetails.sidenav?.updatePaneStatus?.(paneID);
      let pane = itemDetails.getPane?.(paneID);
      let panel = null;
      if (pane) {
        pane.open = true;
        pane.hidden = false;
        itemDetails.pinnedPane = paneID;
        await pane._forceRenderAll?.();
        panel = pane.querySelector("#ai4zotero-panel");
        if (panel) {
          this.forceOpenSectionBody(panel.parentElement);
        }
      }
      await itemDetails.scrollToPane?.(paneID, "smooth");
      return panel || this.getPanel(win);
    } catch (e) {
      Zotero.debug(`AI4Zotero: failed to open item pane section: ${e}`);
      return this.getPanel(win);
    }
  },

  getContextItemDetails(win) {
    let tabID = win.Zotero_Tabs?.selectedID;
    let details = Array.from(win.document.querySelectorAll("#zotero-context-pane-inner item-details"));
    return details.find(elem => elem.tabID === tabID)
      || win.document.getElementById("zotero-context-pane-sidenav")?.container
      || null;
  },

  async openStandaloneReaderPanel(win) {
    if (win?.document?.documentElement?.getAttribute("windowtype") !== "zotero:reader") {
      return null;
    }
    this.loadStandaloneReaderWindow(win);
    let state = this.readerWindows.get(win);
    if (!state) {
      return null;
    }
    state.box.removeAttribute("hidden");
    await this.refreshContextPreview(win, "", state.panel);
    return state.panel;
  },

  async openDockedPanel(win) {
    let panel = this.getOrCreateDockedPanel(win);
    if (!panel) {
      return null;
    }
    panel.closest("#ai4zotero-docked-host")?.removeAttribute("hidden");
    panel.hidden = false;
    this.setContextButtonHidden(win, true);
    await this.refreshContextPreview(win, "", panel);
    return panel;
  },

  async openDockedPanelIfSelected(win) {
    if (Date.now() < this.suppressAutoOpenUntil) {
      return null;
    }
    let paneID = this.registeredPaneID || this.paneID;
    let selected = false;
    for (let itemDetails of win.document.querySelectorAll?.("item-details") || []) {
      if (itemDetails.pinnedPane === paneID || itemDetails.getAttribute?.("pinned-pane") === paneID) {
        selected = true;
        break;
      }
    }
    if (!selected) {
      return null;
    }
    Zotero.debug(`AI4Zotero: detected selected item pane ${paneID}, opening docked panel`);
    return this.openDockedPanel(win);
  },

  getOrCreateDockedPanel(win) {
    let doc = win?.document;
    if (!doc) {
      return null;
    }
    let existing = doc.getElementById("ai4zotero-docked-panel");
    if (existing) {
      this.setContextButtonHidden(win, true);
      return existing;
    }
    let hostParent = doc.getElementById("zotero-context-pane-inner")
      || doc.getElementById("zotero-item-pane")
      || doc.getElementById("zotero-context-pane");
    if (!hostParent) {
      return null;
    }
    let host = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    host.id = "ai4zotero-docked-host";
    host.setAttribute("hidden", "true");
    let panel = this.createPanel(win, { embedded: true, docked: true });
    panel.hidden = false;
    host.append(panel);
    hostParent.append(host);
    this.setContextButtonHidden(win, true);
    return panel;
  },

  hidePanel(win) {
    let panel = this.getPanel(win);
    if (!panel) {
      return;
    }
    panel.hidden = true;
  },

  closePanel(win, panel = this.getPanel(win)) {
    this.suppressAutoOpenUntil = Date.now() + 700;
    if (!panel) {
      return;
    }
    panel.hidden = true;
    panel.closest("#ai4zotero-docked-host")?.setAttribute("hidden", "true");
    panel.closest("#ai4zotero-reader-panel-box")?.setAttribute("hidden", "true");
    this.setContextButtonHidden(win, false);
    let section = panel.closest("item-pane-custom-section");
    if (section) {
      section.open = false;
      section.removeAttribute("open");
    }
  },

  setContextButtonHidden(win, hidden) {
    let doc = win?.document;
    if (!doc) {
      return;
    }
    doc.documentElement?.classList?.toggle("ai4zotero-panel-open", hidden);
    for (let button of doc.querySelectorAll?.("#ai4zotero-context-button") || []) {
      button.hidden = hidden;
      button.toggleAttribute("hidden", hidden);
      button.style.display = hidden ? "none" : "";
      button.style.visibility = hidden ? "hidden" : "";
    }
  },

  getPanel(win) {
    let panels = [
      this.readerWindows.get(win)?.panel,
      win.document.getElementById("ai4zotero-docked-panel"),
      ...Array.from(win.document.querySelectorAll?.(".ai4zotero-panel") || [])
    ].filter(Boolean);
    return panels.find(panel => !panel.hidden && this.isPanelVisible(panel)) || panels[0] || null;
  },

  isPanelVisible(panel) {
    try {
      if (!panel || panel.hidden || panel.closest("[hidden]")) {
        return false;
      }
      let rect = panel.getBoundingClientRect?.();
      return !rect || (rect.width > 80 && rect.height > 120);
    } catch (e) {
      return false;
    }
  },

  saveSettings(win, announce = false, panel = this.getPanel(win)) {
    if (!panel) {
      throw new Error("AI4Zotero 面板不可用。");
    }
    let apiKey = panel.querySelector('[data-field="apiKey"]').value.trim();
    let endpoint = panel.querySelector('[data-field="endpoint"]').value.trim() || this.defaults.endpoint;
    let model = panel.querySelector('[data-field="model"]').value.trim() || this.defaults.model;
    let fontSize = panel.querySelector('[data-field="fontSize"]')?.value || this.defaults.fontSize;
    let reasoningEffort = panel.querySelector('[data-field="reasoningEffort"]')?.value || this.defaults.reasoningEffort;
    let languageStyle = panel.querySelector('[data-field="languageStyle"]')?.value || this.defaults.languageStyle;
    if (!/^https?:\/\//i.test(endpoint)) {
      throw new Error("接口地址必须以 http:// 或 https:// 开头。");
    }
    this.setCharPref(this.prefs.apiKey, apiKey);
    this.setCharPref(this.prefs.endpoint, endpoint);
    this.setCharPref(this.prefs.model, model);
    this.setCharPref(this.prefs.fontSize, fontSize);
    this.setCharPref(this.prefs.reasoningEffort, reasoningEffort);
    this.setCharPref(this.prefs.languageStyle, languageStyle);
    this.applyFontSize(panel);
    this.updateConfigStatus(panel);
    if (announce) {
      this.addMessage(win, "system", "设置已保存。DeepSeek 配置提醒已自动收起。", panel);
      if (apiKey) {
        this.toggleSettings(panel, false);
      }
    }
    Zotero.debug(`AI4Zotero: settings saved (${apiKey ? "api key present" : "no api key"}, model ${model})`);
  },

  applyQuickPrompt(win, type, panel = this.getPanel(win)) {
    let prompts = {
      summarize: "请用中文用 6 个要点概括这篇论文，并列出核心贡献、关键证据和适合继续追问的问题。",
      problem: "这篇论文试图解决什么问题？这个问题为什么重要？请结合论文背景解释。",
      selection: "请用通俗但严谨的中文解释我划线的内容，并说明它和论文主线之间的关系。",
      methods: "请拆解这篇论文的方法：它引入了哪些组件、解决了什么难点、实验设计如何验证方法有效？",
      results: "请提取主要实验结果，和基线方法进行对比，并说明这些结果证明了什么。",
      limitations: "请分析这篇论文可能的局限、隐含假设，以及值得继续做的后续实验。"
    };
    panel.querySelector('[data-field="question"]').value = prompts[type] || prompts.summarize;
    this.refreshContextPreview(win, "", panel, { force: true }).catch(e => this.reportError(win, e, panel));
    panel.querySelector('[data-field="question"]').focus();
  },

  async refreshContextPreview(win, seedContext = "", panel = this.getPanel(win), options = {}) {
    if (!panel) {
      return;
    }
    let key = await this.getCurrentContextKey(win);
    let source = panel.querySelector('[data-role="source"]');
    if (!seedContext && !options.force && panel.dataset.contextKey === key && (panel._ai4zoteroContext || "").trim()) {
      return;
    }
    if (source) {
      source.textContent = "正在同步当前文献...";
    }
    let context = seedContext || await this.getCurrentContext(win);
    if (seedContext) {
      panel._ai4zoteroContext = this.mergeContext(context, panel._ai4zoteroContext || "");
    } else if (options.force || panel.dataset.contextKey !== key || !(panel._ai4zoteroContext || "").trim()) {
      panel._ai4zoteroContext = context;
    }
    panel.dataset.contextKey = key;

    let reader = this.getActiveReader(win);
    let item = reader?.itemID ? Zotero.Items.get(reader.itemID) : this.getSelectedAttachment(win);
    let title = await this.getDisplayTitle(item);
    if (source) {
      source.textContent = title || "未检测到当前阅读器";
    }
  },

  queueAutoContextRefresh(win, panel = this.getPanel(win), delay = 700) {
    if (!panel) {
      return;
    }
    let oldTimer = this.contextTimers.get(panel);
    if (oldTimer) {
      win.clearTimeout(oldTimer);
    }
    let timer = win.setTimeout(() => {
      this.refreshContextPreview(win, "", panel)
        .catch(e => this.reportError(win, e, panel));
    }, delay);
    this.contextTimers.set(panel, timer);
  },

  async getCurrentContextKey(win) {
    let reader = this.getActiveReader(win);
    let item = reader?.itemID ? Zotero.Items.get(reader.itemID) : this.getSelectedAttachment(win);
    let tabID = win.Zotero_Tabs?.selectedID || "";
    let page = reader?._state?.pageIndex ?? reader?.state?.pageIndex ?? "";
    if (item?.id) {
      return `${tabID}:${item.id}:${page}`;
    }
    return `${tabID}:no-item:${page}`;
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
        parts.push(`标题：${title}`);
      }
      let parent = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null;
      if (parent) {
        let creators = parent.getCreatorsJSON?.()
          ?.map(c => [c.firstName, c.lastName].filter(Boolean).join(" "))
          .filter(Boolean)
          .join(", ");
        if (creators) {
          parts.push(`作者：${creators}`);
        }
        let abstractNote = parent.getField("abstractNote");
        if (abstractNote) {
          parts.push(`摘要：${abstractNote}`);
        }
      }
    }

    let selectedText = this.getReaderSelection(reader);
    if (selectedText) {
      parts.push(`划线内容：\n${selectedText}`);
    }

    let annotations = await this.getRecentAnnotations(item);
    if (annotations) {
      parts.push(`最近批注：\n${annotations}`);
    }

    let indexedText = await this.getIndexedAttachmentText(item);
    if (indexedText) {
      parts.push(`Zotero 索引全文：\n${indexedText}`);
    }

    let maxChars = this.getIntPref(this.prefs.maxContextChars, this.defaults.maxContextChars);
    return parts.join("\n\n").slice(0, maxChars);
  },

  getActiveReader(win) {
    try {
      if (win.reader) {
        return win.reader;
      }
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
          return [text, comment && `批注：${comment}`].filter(Boolean).join("\n");
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

  async ask(win, panel = this.getPanel(win)) {
    if (!panel) {
      throw new Error("AI4Zotero 面板不可用。");
    }
    this.saveSettings(win, false, panel);
    await this.refreshContextPreview(win, "", panel);
    let questionField = panel.querySelector('[data-field="question"]');
    let question = questionField.value.trim();
    if (!question) {
      return;
    }

    let apiKey = this.getCharPref(this.prefs.apiKey, "");
    if (!apiKey) {
      this.addMessage(win, "system", "请先填写 DeepSeek API Key。", panel);
      this.toggleSettings(panel, true);
      panel.querySelector('[data-field="apiKey"]').focus();
      return;
    }

    let context = (panel._ai4zoteroContext || "").trim() || await this.getCurrentContext(win);
    let attachments = this.getPanelAttachments(panel);
    let payload = this.buildChatPayload(question, context, attachments);

    this.addMessage(win, "user", question, panel, { attachments });
    questionField.value = "";
    panel._ai4zoteroAttachments = [];
    this.renderAttachmentList(win, panel);
    let pending = this.addMessage(win, "assistant", "正在阅读并组织回答...", panel, {
      pending: true,
      reasoningEffort: this.getCharPref(this.prefs.reasoningEffort, this.defaults.reasoningEffort)
    });

    try {
      let answer = await this.callDeepSeek(payload, apiKey);
      this.setMessageContent(win, pending, answer, "assistant", { done: true });
    } catch (e) {
      this.setMessageContent(win, pending, `请求失败：${e.message || e}`, "system");
    }
  },

  buildChatPayload(question, context, attachments = []) {
    let reasoningEffort = this.getCharPref(this.prefs.reasoningEffort, this.defaults.reasoningEffort);
    let languageStyle = this.getCharPref(this.prefs.languageStyle, this.defaults.languageStyle);
    let systemPrompt = [
      this.getCharPref(this.prefs.systemPrompt, this.defaults.systemPrompt),
      this.getLanguageStyleInstruction(languageStyle),
      this.getReasoningInstruction(reasoningEffort)
    ].filter(Boolean).join("\n");
    let attachmentText = this.describeAttachmentsForText(attachments);
    let userText =
      `论文上下文：\n${context || "（当前没有可用上下文）"}\n\n` +
      `${attachmentText ? `用户补充材料：\n${attachmentText}\n\n` : ""}` +
      `问题：\n${question}`;
    let userContent = [{ type: "text", text: userText }];
    for (let attachment of attachments) {
      if (attachment.kind === "image" && attachment.dataURL) {
        userContent.push({ type: "image_url", image_url: { url: attachment.dataURL } });
      }
    }
    let payload = {
      model: this.getCharPref(this.prefs.model, this.defaults.model),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: this.getTemperatureForStyle(languageStyle),
      stream: false
    };
    return payload;
  },

  getLanguageStyleInstruction(style) {
    let styles = {
      academic: "回答风格：学术严谨，保留必要术语，结构清楚。",
      concise: "回答风格：简洁直接，优先给结论，再给必要依据。",
      teacher: "回答风格：讲解式，先解释直觉，再连接论文细节。",
      reviewer: "回答风格：审稿人视角，指出贡献、证据、假设和潜在局限。"
    };
    return styles[style] || styles.academic;
  },

  getReasoningInstruction(effort) {
    let instructions = {
      fast: "思考强度：快速。请给出短而明确的回答。",
      balanced: "思考强度：均衡。请兼顾准确性和可读性。",
      deep: "思考强度：深入。请分层分析，并在结尾给出总结。"
    };
    return instructions[effort] || instructions.balanced;
  },

  getTemperatureForStyle(style) {
    return style === "teacher" ? 0.35 : 0.2;
  },

  describeAttachmentsForText(attachments = []) {
    if (!attachments.length) {
      return "";
    }
    return attachments.map(attachment => {
      if (attachment.kind === "text" && attachment.text) {
        return `文件：${attachment.name}\n${attachment.text.slice(0, 4000)}`;
      }
      if (attachment.kind === "image") {
        return `图片：${attachment.name}（已作为多模态图片输入附加）`;
      }
      return `文件：${attachment.name}（${attachment.type || "未知类型"}，当前仅作为文件名上下文）`;
    }).join("\n\n");
  },

  async testConnection(win, panel = this.getPanel(win)) {
    if (!panel) {
      throw new Error("AI4Zotero 面板不可用。");
    }
    this.saveSettings(win, false, panel);
    let apiKey = this.getCharPref(this.prefs.apiKey, "");
    if (!apiKey) {
      this.addMessage(win, "system", "请先填写 DeepSeek API Key。", panel);
      panel.querySelector('[data-field="apiKey"]').focus();
      return;
    }

    let pending = this.addMessage(win, "system", "正在测试 DeepSeek 连接...", panel);
    let payload = {
      model: this.getCharPref(this.prefs.model, this.defaults.model),
      messages: [
        { role: "system", content: "请只回复：OK" },
        { role: "user", content: [{ type: "text", text: "连接测试" }] }
      ],
      temperature: 0,
      stream: false
    };
    let answer = await this.callDeepSeek(payload, apiKey);
    this.setMessageContent(win, pending, `连接成功。DeepSeek 返回：${answer}`, "system");
  },

  async addFilesToPanel(win, panel, files) {
    if (!files.length) {
      return;
    }
    let attachments = panel._ai4zoteroAttachments || [];
    for (let file of files.slice(0, 5)) {
      attachments.push(await this.readAttachmentFile(win, file));
    }
    panel._ai4zoteroAttachments = attachments.slice(-8);
    this.renderAttachmentList(win, panel);
  },

  async readAttachmentFile(win, file) {
    let isImage = /^image\//i.test(file.type || "");
    let isText = /^(text\/|application\/json)/i.test(file.type || "") || /\.(txt|md|csv|json)$/i.test(file.name || "");
    if (isImage) {
      return {
        id: `${Date.now()}-${Math.random()}`,
        kind: "image",
        name: file.name,
        type: file.type,
        size: file.size,
        dataURL: await this.readFileAsDataURL(win, file)
      };
    }
    if (isText) {
      return {
        id: `${Date.now()}-${Math.random()}`,
        kind: "text",
        name: file.name,
        type: file.type,
        size: file.size,
        text: await this.readFileAsText(win, file)
      };
    }
    return {
      id: `${Date.now()}-${Math.random()}`,
      kind: "file",
      name: file.name,
      type: file.type,
      size: file.size
    };
  },

  readFileAsDataURL(win, file) {
    return new Promise((resolve, reject) => {
      let reader = new win.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("图片读取失败。"));
      reader.readAsDataURL(file);
    });
  },

  readFileAsText(win, file) {
    return new Promise((resolve, reject) => {
      let reader = new win.FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("文件读取失败。"));
      reader.readAsText(file);
    });
  },

  renderAttachmentList(win, panel) {
    let wrap = panel.querySelector('[data-role="attachments"]');
    if (!wrap) {
      return;
    }
    wrap.replaceChildren();
    let attachments = panel._ai4zoteroAttachments || [];
    for (let attachment of attachments) {
      let chip = win.document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      chip.type = "button";
      chip.className = "zda-attachment-chip";
      chip.textContent = `${attachment.kind === "image" ? "图片" : "文件"} · ${attachment.name}`;
      chip.title = "点击移除此附件";
      chip.addEventListener("click", () => {
        panel._ai4zoteroAttachments = (panel._ai4zoteroAttachments || [])
          .filter(item => item.id !== attachment.id);
        this.renderAttachmentList(win, panel);
      });
      wrap.append(chip);
    }
  },

  getPanelAttachments(panel) {
    return panel._ai4zoteroAttachments || [];
  },

  async callDeepSeek(payload, apiKey) {
    let endpoint = this.getCharPref(this.prefs.endpoint, this.defaults.endpoint);
    let xhr = await Zotero.HTTP.request("POST", endpoint, {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      responseType: "json",
      successCodes: false,
      errorDelayMax: 0,
      timeout: 60000
    });

    let response = xhr.response;
    if (!response && xhr.responseText) {
      try {
        response = JSON.parse(xhr.responseText);
      } catch (e) {
        response = {};
      }
    }
    if (xhr.status < 200 || xhr.status >= 300) {
      let message = response?.error?.message || xhr.responseText || `HTTP ${xhr.status}`;
      throw new Error(`DeepSeek API ${xhr.status}: ${message}`);
    }
    let content = response?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("DeepSeek 返回了空响应。");
    }
    return content.trim();
  },

  addMessage(win, role, text, panel = this.getPanel(win), options = {}) {
    if (!panel) {
      Zotero.debug(`AI4Zotero ${role}: ${text}`);
      return null;
    }
    let chat = panel.querySelector('[data-role="chat"]');
    chat.querySelector('[data-role="empty"]')?.remove();
    let message = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    message.className = `zda-message zda-${role}`;
    this.setMessageContent(win, message, text, role, options);
    chat.appendChild(message);
    chat.scrollTop = chat.scrollHeight;
    return message;
  },

  setMessageContent(win, message, text, role, options = {}) {
    if (!message) {
      return;
    }
    message.replaceChildren();
    message.className = message.className
      .replace(/\bzda-(user|assistant|system)\b/g, "")
      .trim();
    message.classList.add("zda-message", `zda-${role}`);
    if (role === "assistant") {
      message.classList.add("zda-markdown");
      this.appendThinkingBar(win, message, options);
      this.renderMarkdown(win, message, text);
      this.appendAssistantActions(win, message);
    } else if (role === "user") {
      message.classList.remove("zda-markdown");
      let bubble = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      bubble.className = "zda-user-bubble";
      bubble.textContent = text;
      message.append(bubble);
      this.appendMessageAttachments(win, message, options.attachments || []);
    } else {
      message.classList.remove("zda-markdown");
      message.textContent = text;
    }
  },

  appendThinkingBar(win, message, options = {}) {
    let bar = win.document.createElementNS("http://www.w3.org/1999/xhtml", "details");
    bar.className = "zda-thinking";
    bar.open = Boolean(options.pending);
    let summary = win.document.createElementNS("http://www.w3.org/1999/xhtml", "summary");
    let effort = ({ fast: "快速", balanced: "均衡", deep: "深入" })[options.reasoningEffort] || "均衡";
    summary.textContent = options.pending ? `Thinking... · ${effort}` : "Thinking Finished";
    let body = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    body.textContent = options.pending ? "正在结合当前文献、划线和补充材料组织回答。" : "已完成阅读与组织。";
    bar.append(summary, body);
    message.append(bar);
  },

  appendAssistantActions(win, message) {
    let actions = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    actions.className = "zda-message-actions";
    for (let item of ["赞", "踩", "复制"]) {
      let button = win.document.createElementNS("http://www.w3.org/1999/xhtml", "button");
      button.type = "button";
      button.textContent = item;
      if (item === "复制") {
        button.addEventListener("click", () => {
          win.navigator?.clipboard?.writeText?.(message.innerText || "");
        });
      }
      actions.append(button);
    }
    message.append(actions);
  },

  appendMessageAttachments(win, message, attachments = []) {
    if (!attachments.length) {
      return;
    }
    let wrap = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    wrap.className = "zda-message-attachments";
    for (let attachment of attachments) {
      let chip = win.document.createElementNS("http://www.w3.org/1999/xhtml", "span");
      chip.textContent = `${attachment.kind === "image" ? "图片" : "文件"} · ${attachment.name}`;
      wrap.append(chip);
    }
    message.append(wrap);
  },

  renderMarkdown(win, container, text) {
    let doc = win.document;
    let lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    let paragraph = [];
    let list = null;
    let listType = "";
    let codeFence = null;
    let codeLines = [];

    let flushParagraph = () => {
      if (!paragraph.length) {
        return;
      }
      let p = doc.createElementNS("http://www.w3.org/1999/xhtml", "p");
      this.appendInlineMarkdown(doc, p, paragraph.join(" "));
      container.append(p);
      paragraph = [];
    };
    let flushList = () => {
      if (list) {
        container.append(list);
        list = null;
        listType = "";
      }
    };
    let flushCode = () => {
      if (!codeFence) {
        return;
      }
      this.appendMarkdownCodeBlock(doc, container, codeLines.join("\n"), codeFence);
      codeFence = null;
      codeLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      let rawLine = lines[i];
      let line = rawLine.trim();
      let fence = line.match(/^```([\w-]*)\s*$/);
      if (fence) {
        if (codeFence) {
          flushCode();
        } else {
          flushParagraph();
          flushList();
          codeFence = fence[1] || "";
          codeLines = [];
        }
        continue;
      }
      if (codeFence) {
        codeLines.push(rawLine);
        continue;
      }

      if (!line) {
        flushParagraph();
        flushList();
        continue;
      }

      let inlineDisplayMath = line.match(/^\$\$(.+)\$\$$/);
      if (inlineDisplayMath) {
        flushParagraph();
        flushList();
        this.appendMarkdownMathBlock(doc, container, inlineDisplayMath[1]);
        continue;
      }
      if (line === "$$") {
        flushParagraph();
        flushList();
        let mathLines = [];
        i++;
        while (i < lines.length && lines[i].trim() !== "$$") {
          mathLines.push(lines[i]);
          i++;
        }
        this.appendMarkdownMathBlock(doc, container, mathLines.join("\n"));
        continue;
      }

      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
        flushParagraph();
        flushList();
        container.append(doc.createElementNS("http://www.w3.org/1999/xhtml", "hr"));
        continue;
      }

      if (this.isMarkdownTableRow(line) && this.isMarkdownTableSeparator(lines[i + 1]?.trim())) {
        flushParagraph();
        flushList();
        let headers = this.splitMarkdownTableRow(line);
        let aligns = this.splitMarkdownTableRow(lines[i + 1].trim()).map(cell => {
          let value = cell.trim();
          if (/^:-+:$/.test(value)) {
            return "center";
          }
          if (/^-+:$/.test(value)) {
            return "right";
          }
          if (/^:-+$/.test(value)) {
            return "left";
          }
          return "";
        });
        let rows = [];
        i += 2;
        while (i < lines.length && this.isMarkdownTableRow(lines[i].trim())) {
          rows.push(this.splitMarkdownTableRow(lines[i].trim()));
          i++;
        }
        i--;
        this.appendMarkdownTable(doc, container, headers, aligns, rows);
        continue;
      }

      let quote = line.match(/^>\s?(.+)$/);
      if (quote) {
        flushParagraph();
        flushList();
        let blockquote = doc.createElementNS("http://www.w3.org/1999/xhtml", "blockquote");
        this.appendInlineMarkdown(doc, blockquote, quote[1]);
        container.append(blockquote);
        continue;
      }

      let heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        let level = Math.min(4, Math.max(3, heading[1].length + 2));
        let h = doc.createElementNS("http://www.w3.org/1999/xhtml", `h${level}`);
        this.appendInlineMarkdown(doc, h, heading[2]);
        container.append(h);
        continue;
      }

      let bullet = line.match(/^[-*]\s+(.+)$/);
      let ordered = line.match(/^\d+[.)]\s+(.+)$/);
      if (bullet || ordered) {
        flushParagraph();
        let nextType = bullet ? "ul" : "ol";
        if (!list || listType !== nextType) {
          flushList();
          list = doc.createElementNS("http://www.w3.org/1999/xhtml", nextType);
          listType = nextType;
        }
        let li = doc.createElementNS("http://www.w3.org/1999/xhtml", "li");
        this.appendInlineMarkdown(doc, li, bullet ? bullet[1] : ordered[1]);
        list.append(li);
        continue;
      }

      paragraph.push(line);
    }

    flushParagraph();
    flushList();
    flushCode();
  },

  appendInlineMarkdown(doc, parent, text) {
    let pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$[^$\n]+\$)/g;
    let index = 0;
    let value = String(text || "");
    for (let match of value.matchAll(pattern)) {
      if (match.index > index) {
        parent.append(doc.createTextNode(value.slice(index, match.index)));
      }
      let token = match[0];
      if (token.startsWith("**")) {
        let strong = doc.createElementNS("http://www.w3.org/1999/xhtml", "strong");
        strong.textContent = token.slice(2, -2);
        parent.append(strong);
      } else if (token.startsWith("`")) {
        let code = doc.createElementNS("http://www.w3.org/1999/xhtml", "code");
        code.textContent = token.slice(1, -1);
        parent.append(code);
      } else if (token.startsWith("[")) {
        let link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        let a = doc.createElementNS("http://www.w3.org/1999/xhtml", "a");
        a.textContent = link?.[1] || token;
        a.href = this.sanitizeMarkdownHref(link?.[2] || "");
        a.target = "_blank";
        a.rel = "noreferrer";
        parent.append(a);
      } else {
        let math = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        math.className = "zda-math";
        math.textContent = this.normalizeLatexMath(token);
        parent.append(math);
      }
      index = match.index + token.length;
    }
    if (index < value.length) {
      parent.append(doc.createTextNode(value.slice(index)));
    }
  },

  isMarkdownTableRow(line) {
    return Boolean(line && line.includes("|") && !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line));
  },

  isMarkdownTableSeparator(line) {
    return Boolean(line && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line));
  },

  splitMarkdownTableRow(line) {
    let value = String(line || "").trim();
    if (value.startsWith("|")) {
      value = value.slice(1);
    }
    if (value.endsWith("|")) {
      value = value.slice(0, -1);
    }
    let cells = [];
    let current = "";
    let escaped = false;
    for (let char of value) {
      if (escaped) {
        current += char;
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "|") {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (escaped) {
      current += "\\";
    }
    cells.push(current.trim());
    return cells;
  },

  sanitizeMarkdownHref(href) {
    let value = String(href || "").trim();
    return /^(https?:|mailto:|doi:|zotero:)/i.test(value) ? value : "#";
  },

  appendMarkdownTable(doc, container, headers, aligns, rows) {
    let wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    wrap.className = "zda-table-wrap";
    let table = doc.createElementNS("http://www.w3.org/1999/xhtml", "table");
    let thead = doc.createElementNS("http://www.w3.org/1999/xhtml", "thead");
    let headRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "tr");
    headers.forEach((header, index) => {
      let th = doc.createElementNS("http://www.w3.org/1999/xhtml", "th");
      if (aligns[index]) {
        th.style.textAlign = aligns[index];
      }
      this.appendInlineMarkdown(doc, th, header);
      headRow.append(th);
    });
    thead.append(headRow);
    table.append(thead);
    let tbody = doc.createElementNS("http://www.w3.org/1999/xhtml", "tbody");
    for (let row of rows) {
      let tr = doc.createElementNS("http://www.w3.org/1999/xhtml", "tr");
      for (let index = 0; index < headers.length; index++) {
        let td = doc.createElementNS("http://www.w3.org/1999/xhtml", "td");
        if (aligns[index]) {
          td.style.textAlign = aligns[index];
        }
        this.appendInlineMarkdown(doc, td, row[index] || "");
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    container.append(wrap);
  },

  appendMarkdownCodeBlock(doc, container, codeText, language = "") {
    let pre = doc.createElementNS("http://www.w3.org/1999/xhtml", "pre");
    let code = doc.createElementNS("http://www.w3.org/1999/xhtml", "code");
    if (language) {
      code.dataset.language = language;
    }
    code.textContent = codeText;
    pre.append(code);
    container.append(pre);
  },

  appendMarkdownMathBlock(doc, container, mathText) {
    let block = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    block.className = "zda-math-block";
    block.textContent = this.normalizeLatexMath(mathText);
    container.append(block);
  },

  normalizeLatexMath(token) {
    let value = String(token || "")
      .replace(/^\\\(|\\\)$/g, "")
      .replace(/^\\\[|\\\]$/g, "")
      .replace(/^\$\$|\$\$$/g, "")
      .replace(/^\$|\$$/g, "")
      .trim();
    let commandMap = {
      "\\cdot": "·",
      "\\times": "×",
      "\\rightarrow": "→",
      "\\leftarrow": "←",
      "\\leq": "≤",
      "\\geq": "≥",
      "\\neq": "≠",
      "\\approx": "≈",
      "\\sim": "∼",
      "\\infty": "∞",
      "\\alpha": "α",
      "\\beta": "β",
      "\\gamma": "γ",
      "\\delta": "δ",
      "\\lambda": "λ",
      "\\theta": "θ",
      "\\mu": "μ",
      "\\sigma": "σ",
      "\\pi": "π"
    };
    value = value.replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1");
    for (let [command, replacement] of Object.entries(commandMap)) {
      value = value.split(command).join(replacement);
    }
    value = value
      .replace(/\\([a-zA-Z]+)/g, "$1")
      .replace(/\^\{([^{}]+)\}/g, "^$1")
      .replace(/_\{([^{}]+)\}/g, "_$1")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return value || token;
  },

  reportError(win, error, panel = this.getPanel(win)) {
    Zotero.debug(`DeepSeek Assistant: ${error?.stack || error}`);
    this.addMessage(win, "system", error?.message || String(error), panel);
  },

  registerReaderHooks() {
    if (!Zotero.Reader?.registerEventListener) {
      return;
    }

    let toolbarHandler = event => {
      let { reader, doc, append } = event;
      if (reader?._window?.document?.documentElement?.getAttribute("windowtype") === "zotero:reader") {
        this.loadStandaloneReaderWindow(reader._window);
      }
      let button = doc.createElement("button");
      button.className = "ai4zotero-reader-toolbar-button";
      button.type = "button";
      button.textContent = "AI";
      button.title = "打开 AI4Zotero";
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
        this.showPanel(reader._window, { focus: "question" })
          .catch(e => this.reportError(reader._window, e));
      });
      append(button);
    };

    let selectionHandler = event => {
      let { reader, doc, params, append } = event;
      let button = doc.createElement("button");
      button.className = "ai4zotero-selection-button";
      button.textContent = "问 AI";
      button.style.cssText = "margin-left:4px;padding:3px 8px;border-radius:6px;border:1px solid rgba(47,128,237,.38);background:#fff;color:#1f2328;font:menu;font-weight:600;";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        let text = params?.annotation?.text || params?.text || this.getReaderSelection(reader) || "";
        this.showPanel(reader._window, {
          context: text ? `划线内容：\n${text}` : "",
          question: "请解释这段划线内容，并说明它与论文核心贡献的关系。",
          focus: "question"
        }).catch(e => this.reportError(reader._window, e));
      });
      append(button);
    };

    let annotationMenuHandler = event => {
      let { reader, params, append } = event;
      append({
        label: "用 DeepSeek 询问所选批注",
        onCommand: () => {
          let context = this.getAnnotationContextFromIDs(reader, params?.ids || []);
          this.showPanel(reader._window, {
            context,
            question: "请解释这些批注，并总结它们为什么重要。",
            focus: "question"
          }).catch(e => this.reportError(reader._window, e));
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
          return [text, comment && `批注：${comment}`].filter(Boolean).join("\n");
        })
        .filter(Boolean);
      return selected.length ? `所选批注：\n${selected.join("\n\n")}` : "";
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
