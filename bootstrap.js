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
    button.setAttribute("tooltiptext", "Open AI4Zotero");
    button.addEventListener("command", () => this.togglePanel(win, { focus: "question" }));

    let toolbar = doc.getElementById("zotero-tabs-toolbar") || doc.getElementById("zotero-toolbar");
    if (toolbar) {
      toolbar.appendChild(button);
    }

    let menuitem = this.createToolsMenuItem(win);
    let contextButton = this.createContextPaneButton(win);
    let sideNavHandler = () => {
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
    button.textContent = "AI";
    button.title = "Open AI4Zotero";
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      this.showPanel(win, { focus: "question" }).catch(e => this.reportError(win, e));
    });
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
        setSectionSummary(this.getCharPref(this.prefs.apiKey, "") ? "Ready" : "API key required");
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
    let label = (text, control) => h("label", {}, [doc.createTextNode(text), control]);

    append(html, [
      h("div", { className: "zda-topbar" }, [
        h("div", { className: "zda-title-group" }, [
          h("div", { className: "zda-title", text: "AI4Zotero" }),
          h("div", {
            className: "zda-subtitle",
            "data-role": "source",
            text: "No paper context"
          })
        ]),
        h("div", { className: "zda-top-actions" }, [
          button("↻", { className: "zda-icon-button", "data-action": "refresh-context", title: "Refresh context" }),
          button("⚙", { className: "zda-icon-button", "data-action": "toggle-settings", title: "DeepSeek settings" }),
          button("×", { className: "zda-icon-button", "data-action": "close", title: "Close" })
        ])
      ]),
      h("div", { className: "zda-status", "data-role": "config-status" }),
      h("div", { className: "zda-settings", "data-role": "settings", hidden: true }, [
        h("div", { className: "zda-section-title", text: "DeepSeek API" }),
        label("API Key", input("apiKey", { type: "password", placeholder: "sk-...", autocomplete: "off" })),
        label("Endpoint", input("endpoint", { type: "url" })),
        label("Model", input("model", { type: "text" })),
        h("div", { className: "zda-settings-actions" }, [
          button("Save", { "data-action": "save-settings" }),
          button("Test", { "data-action": "test-api" })
        ])
      ]),
      h("div", { className: "zda-prompt-strip" }, [
        button("Summary", { "data-prompt": "summarize" }),
        button("Problem", { "data-prompt": "problem" }),
        button("Method", { "data-prompt": "methods" }),
        button("Results", { "data-prompt": "results" }),
        button("Explain", { "data-prompt": "selection" })
      ]),
      h("div", { className: "zda-context" }, [
        h("div", { className: "zda-context-head" }, [
          h("span", { className: "zda-section-title", text: "Context" }),
          h("div", { className: "zda-context-actions" }, [
            button("Use Paper", { "data-action": "refresh-context" }),
            button("Clear", { "data-action": "clear-context" })
          ])
        ]),
        h("textarea", {
          "data-field": "context",
          placeholder: "Paper, selection, annotations, and indexed full text appear here.",
          spellcheck: "false"
        })
      ]),
      h("div", { className: "zda-chat", "data-role": "chat" }, [
        h("div", {
          className: "zda-empty",
          "data-role": "empty",
          text: "Ask anything about this paper, or highlight text and choose Ask AI."
        })
      ]),
      h("form", { className: "zda-composer", "data-role": "composer" }, [
        h("textarea", {
          "data-field": "question",
          placeholder: "Ask or search anything in this paper...",
          rows: "3"
        }),
        button("Ask", { type: "submit", className: "zda-ask-button", "data-action": "ask" })
      ])
    ]);

    html.querySelector('[data-action="close"]').addEventListener("click", () => {
      if (embedded) {
        let section = html.closest("item-pane-custom-section");
        if (section) {
          section.open = false;
        } else {
          html.closest("#ai4zotero-docked-host")?.setAttribute("hidden", "true");
        }
      } else if (standaloneReader) {
        html.closest("#ai4zotero-reader-panel-box")?.setAttribute("hidden", "true");
      } else {
        this.hidePanel(win);
      }
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
    for (let refreshButton of html.querySelectorAll('[data-action="refresh-context"]')) {
      refreshButton.addEventListener("click", () => {
        this.refreshContextPreview(win, "", html).catch(e => this.reportError(win, e, html));
      });
    }
    for (let clearButton of html.querySelectorAll('[data-action="clear-context"]')) {
      clearButton.addEventListener("click", () => {
        html.querySelector('[data-field="context"]').value = "";
      });
    }
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
    this.updateConfigStatus(html);
    this.toggleSettings(html, !this.getCharPref(this.prefs.apiKey, ""));
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
    await this.refreshContextPreview(win, "", panel);
    return panel;
  },

  async openDockedPanelIfSelected(win) {
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
    return panel;
  },

  hidePanel(win) {
    let panel = this.getPanel(win);
    if (!panel) {
      return;
    }
    panel.hidden = true;
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
      throw new Error("AI4Zotero panel is not available.");
    }
    let apiKey = panel.querySelector('[data-field="apiKey"]').value.trim();
    let endpoint = panel.querySelector('[data-field="endpoint"]').value.trim() || this.defaults.endpoint;
    let model = panel.querySelector('[data-field="model"]').value.trim() || this.defaults.model;
    if (!/^https?:\/\//i.test(endpoint)) {
      throw new Error("Endpoint must start with http:// or https://");
    }
    this.setCharPref(this.prefs.apiKey, apiKey);
    this.setCharPref(this.prefs.endpoint, endpoint);
    this.setCharPref(this.prefs.model, model);
    this.updateConfigStatus(panel);
    if (announce) {
      this.addMessage(win, "system", "Settings saved locally in Zotero preferences.", panel);
    }
    Zotero.debug(`AI4Zotero: settings saved (${apiKey ? "api key present" : "no api key"}, model ${model})`);
  },

  applyQuickPrompt(win, type, panel = this.getPanel(win)) {
    let prompts = {
      summarize: "Summarize this paper in 6 bullet points, then list the main contribution and key evidence.",
      problem: "What problem does this paper solve, and why is the problem important?",
      selection: "Explain the selected text in plain language and relate it to the paper's main argument.",
      methods: "Explain the method section: what problem is solved, what components are introduced, and how evaluation is designed.",
      results: "Extract the main experimental results, compare them with baselines, and explain what they prove.",
      limitations: "Identify the likely limitations, assumptions, and possible follow-up experiments for this paper."
    };
    panel.querySelector('[data-field="question"]').value = prompts[type] || prompts.summarize;
    this.refreshContextPreview(win, "", panel).catch(e => this.reportError(win, e, panel));
    panel.querySelector('[data-field="question"]').focus();
  },

  async refreshContextPreview(win, seedContext = "", panel = this.getPanel(win)) {
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

  async ask(win, panel = this.getPanel(win)) {
    if (!panel) {
      throw new Error("AI4Zotero panel is not available.");
    }
    this.saveSettings(win, false, panel);
    let questionField = panel.querySelector('[data-field="question"]');
    let question = questionField.value.trim();
    if (!question) {
      return;
    }

    let apiKey = this.getCharPref(this.prefs.apiKey, "");
    if (!apiKey) {
      this.addMessage(win, "system", "Please set your DeepSeek API key first.", panel);
      this.toggleSettings(panel, true);
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

    this.addMessage(win, "user", question, panel);
    questionField.value = "";
    let pending = this.addMessage(win, "assistant", "Thinking...", panel);

    try {
      let answer = await this.callDeepSeek(payload, apiKey);
      pending.textContent = answer;
    } catch (e) {
      pending.textContent = `Request failed: ${e.message || e}`;
    }
  },

  async testConnection(win, panel = this.getPanel(win)) {
    if (!panel) {
      throw new Error("AI4Zotero panel is not available.");
    }
    this.saveSettings(win, false, panel);
    let apiKey = this.getCharPref(this.prefs.apiKey, "");
    if (!apiKey) {
      this.addMessage(win, "system", "Please set your DeepSeek API key first.", panel);
      panel.querySelector('[data-field="apiKey"]').focus();
      return;
    }

    let pending = this.addMessage(win, "system", "Testing DeepSeek connection...", panel);
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
      throw new Error("DeepSeek returned an empty response.");
    }
    return content.trim();
  },

  addMessage(win, role, text, panel = this.getPanel(win)) {
    if (!panel) {
      Zotero.debug(`AI4Zotero ${role}: ${text}`);
      return null;
    }
    let chat = panel.querySelector('[data-role="chat"]');
    chat.querySelector('[data-role="empty"]')?.remove();
    let message = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    message.className = `zda-message zda-${role}`;
    message.textContent = text;
    chat.appendChild(message);
    chat.scrollTop = chat.scrollHeight;
    return message;
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
        this.showPanel(reader._window, { focus: "question" })
          .catch(e => this.reportError(reader._window, e));
      });
      append(button);
    };

    let selectionHandler = event => {
      let { reader, doc, params, append } = event;
      let button = doc.createElement("button");
      button.className = "ai4zotero-selection-button";
      button.textContent = "Ask AI";
      button.style.cssText = "margin-left:4px;padding:3px 8px;border-radius:6px;border:1px solid rgba(0,0,0,.22);background:#fff;color:#1f2328;font:menu;";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        let text = params?.annotation?.text || params?.text || this.getReaderSelection(reader) || "";
        this.showPanel(reader._window, {
          context: text ? `Selected text:\n${text}` : "",
          question: "Explain the selected text and connect it to the paper's main contribution.",
          focus: "question"
        }).catch(e => this.reportError(reader._window, e));
      });
      append(button);
    };

    let annotationMenuHandler = event => {
      let { reader, params, append } = event;
      append({
        label: "Ask DeepSeek about selection",
        onCommand: () => {
          let context = this.getAnnotationContextFromIDs(reader, params?.ids || []);
          this.showPanel(reader._window, {
            context,
            question: "Explain these annotations and summarize why they matter.",
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
