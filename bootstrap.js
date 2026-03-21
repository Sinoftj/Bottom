var tagSelectorTopPlugin;

function install(data, reason) {}
function uninstall(data, reason) {}

function startup({ id, version, rootURI }, reason) {
  tagSelectorTopPlugin = new TagSelectorTopPlugin(rootURI);
  const wins = Zotero.getMainWindows();
  for (const win of wins) {
    tagSelectorTopPlugin.addToWindow(win);
  }
}

function shutdown({ id, version, rootURI }, reason) {
  tagSelectorTopPlugin?.shutdown();
  tagSelectorTopPlugin = null;
}

function onMainWindowLoad({ window }) {
  tagSelectorTopPlugin?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  tagSelectorTopPlugin?.removeFromWindow(window);
}

class TagSelectorTopPlugin {
  constructor(rootURI) {
    this.rootURI = rootURI;
    this._windowData = new WeakMap();
  }

  startup() {
    const wins = Zotero.getMainWindows();
    for (const win of wins) {
      this.addToWindow(win);
    }
  }

  shutdown() {
    const wins = Zotero.getMainWindows();
    for (const win of wins) {
      this.removeFromWindow(win);
    }
  }

  addToWindow(win) {
    const doc = win.document;
    if (!doc) return;
    if (doc.getElementById("tag-selector-top-plugin-style")) return;

    const styleEl = doc.createElement("style");
    styleEl.id = "tag-selector-top-plugin-style";
    styleEl.textContent = `
      #zotero-tag-selector .tag-selector {
        display: flex !important;
        flex-direction: column !important;
        height: 100% !important;
        overflow: hidden !important;
      }

      #zotero-tag-selector .tag-selector-filter-pane {
        order: -1 !important;
        border-top: none !important;
        border-bottom: none !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding-bottom: 0 !important;
        flex-shrink: 0 !important;
      }

      #zotero-tag-selector .tag-selector-filter-container {
        border-top: none !important;
      }

      #zotero-tag-selector .tag-quick-filter {
        display: flex !important;
        flex-direction: column !important;
        gap: 14px !important;
        padding: 7px 14px 5px 14px !important;
        box-sizing: border-box !important;
        border-bottom: 1px solid var(--material-border, #c8c8c8) !important;
        flex-shrink: 0 !important;
      }

      #zotero-tag-selector .tag-quick-filter-row {
        display: flex !important;
        flex-direction: row !important;
        justify-content: stretch !important;
        gap: 7px !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }

      #zotero-tag-selector .tag-quick-filter-btn {
        flex: 1 1 0 !important;
        height: 28px !important;
        min-width: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 13px !important;
        font-weight: bold !important;
        cursor: pointer !important;
        border-radius: 4px !important;
        border: none !important;
        background: rgba(0, 0, 0, 0.10) !important;
        color: inherit !important;
        box-sizing: border-box !important;
        padding: 0 !important;
        transition: background 0.15s !important;
      }

      #zotero-tag-selector .tag-quick-filter-btn:hover {
        background: rgba(0, 0, 0, 0.18) !important;
      }

      #zotero-tag-selector .tag-quick-filter-btn.active {
        background: var(--accent-blue, #1a73e8) !important;
        color: #fff !important;
      }

      #zotero-tag-selector .tag-quick-filter-btn.clear-btn {
        background: rgba(0, 0, 0, 0.10) !important;
      }

      #zotero-tag-selector .tag-quick-filter-btn.clear-btn.has-filter {
        background: #e91e8c !important;
        color: #fff !important;
      }

      #zotero-tag-selector .tag-quick-filter-btn.clear-btn.has-filter:hover {
        background: #c2177a !important;
      }

      #zotero-tag-selector .tag-quick-filter-btn.clear-btn svg path {
        fill: currentColor !important;
      }

      #zotero-tag-selector .tag-selector-list-container {
        flex: 1 1 0 !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }

      #zotero-tag-selector .tag-selector-list {
        width: 100% !important;
        height: 100% !important;
      }
    `;
    doc.documentElement.appendChild(styleEl);

    const entry = {
      styleEl,
      initObserver: null,
      mutationObserver: null,
      activeLetter: null,
      _originalGetTagsAndScope: null,
      _clearBtn: null,
    };
    this._windowData.set(win, entry);

    this._waitForFilterPane(win, entry);
  }

  removeFromWindow(win) {
    const entry = this._windowData.get(win);
    if (!entry) return;

    entry.initObserver?.disconnect();
    entry.mutationObserver?.disconnect();
    entry.styleEl?.remove();

    try {
      const doc = win.document;
      const tagSelector = win.ZoteroPane?.tagSelector;

      if (tagSelector && entry._originalGetTagsAndScope) {
        tagSelector.getTagsAndScope = entry._originalGetTagsAndScope;
        entry._originalGetTagsAndScope = null;
        tagSelector.getTagsAndScope().then(result => {
          tagSelector.setState({ tags: result.tags, scope: result.scope });
        }).catch(() => {});
      }

      const container = doc.querySelector("#zotero-tag-selector .tag-selector");
      const filterPane = doc.querySelector("#zotero-tag-selector .tag-selector-filter-pane");
      const quickFilter = doc.getElementById("tag-quick-filter");

      quickFilter?.remove();

      if (container && filterPane) {
        container.appendChild(filterPane);
      }
    } catch (e) {}

    this._windowData.delete(win);
  }

  _waitForFilterPane(win, entry) {
    const doc = win.document;

    const tagSelectorEl = doc.querySelector("#zotero-tag-selector");
    if (!tagSelectorEl) {
      win.setTimeout(() => this._waitForFilterPane(win, entry), 500);
      return;
    }

    const container = doc.querySelector("#zotero-tag-selector .tag-selector");
    const filterPane = doc.querySelector("#zotero-tag-selector .tag-selector-filter-pane");
    if (container && filterPane) {
      this._hookGetTagsAndScope(win, entry);
      this._moveFilterPaneToTop(doc, win, entry, container, filterPane);
      this._setupMutationObserver(win, entry, container);
      return;
    }

    const initObserver = new win.MutationObserver(() => {
      const c = doc.querySelector("#zotero-tag-selector .tag-selector");
      const fp = doc.querySelector("#zotero-tag-selector .tag-selector-filter-pane");
      if (c && fp) {
        initObserver.disconnect();
        entry.initObserver = null;
        this._hookGetTagsAndScope(win, entry);
        this._moveFilterPaneToTop(doc, win, entry, c, fp);
        this._setupMutationObserver(win, entry, c);
      }
    });

    initObserver.observe(tagSelectorEl, { childList: true, subtree: true });
    entry.initObserver = initObserver;
  }

  _hookGetTagsAndScope(win, entry) {
    const tagSelector = win.ZoteroPane?.tagSelector;
    if (!tagSelector) return;
    if (entry._originalGetTagsAndScope) return;

    const original = tagSelector.getTagsAndScope.bind(tagSelector);
    entry._originalGetTagsAndScope = tagSelector.getTagsAndScope;

    const plugin = this;

    tagSelector.getTagsAndScope = async function (...args) {
      const result = await original(...args);

      if (!entry.activeLetter) return result;

      const filtered = result.tags.filter(t => {
        if (!t || typeof t.tag !== "string") return false;
        if (t.type !== 0) return true;
        return plugin._getFirstLetter(t.tag) === entry.activeLetter;
      });

      return { ...result, tags: filtered };
    };
  }

  _moveFilterPaneToTop(doc, win, entry, container, filterPane) {
    if (container.firstElementChild !== filterPane) {
      container.prepend(filterPane);
    }

    if (doc.getElementById("tag-quick-filter")) return;

    const quickFilter = doc.createElement("div");
    quickFilter.id = "tag-quick-filter";
    quickFilter.className = "tag-quick-filter";

    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const allItems = [...letters, "CLEAR"];

    for (let rowIdx = 0; rowIdx < 3; rowIdx++) {
      const rowEl = doc.createElement("div");
      rowEl.className = "tag-quick-filter-row";

      for (let colIdx = 0; colIdx < 9; colIdx++) {
        const item = allItems[rowIdx * 9 + colIdx];
        const btn = doc.createElement("button");
        btn.className = "tag-quick-filter-btn";

        if (item === "CLEAR") {
          btn.classList.add("clear-btn");
          btn.title = "清除筛选";

          const svgNS = "http://www.w3.org/2000/svg";
          const svg = doc.createElementNS(svgNS, "svg");
          svg.setAttribute("viewBox", "0 0 24 24");
          svg.setAttribute("fill", "none");
          svg.setAttribute("width", "14");
          svg.setAttribute("height", "14");

          const path = doc.createElementNS(svgNS, "path");
          path.setAttribute("d", "M4.52185 7H7C7.55229 7 8 7.44772 8 8C8 8.55229 7.55228 9 7 9H3C1.89543 9 1 8.10457 1 7V3C1 2.44772 1.44772 2 2 2C2.55228 2 3 2.44772 3 3V5.6754C4.26953 3.8688 6.06062 2.47676 8.14852 1.69631C10.6633 0.756291 13.435 0.768419 15.9415 1.73041C18.448 2.69239 20.5161 4.53782 21.7562 6.91897C22.9963 9.30013 23.3228 12.0526 22.6741 14.6578C22.0254 17.263 20.4464 19.541 18.2345 21.0626C16.0226 22.5842 13.3306 23.2444 10.6657 22.9188C8.00083 22.5931 5.54702 21.3041 3.76664 19.2946C2.20818 17.5356 1.25993 15.3309 1.04625 13.0078C0.995657 12.4579 1.45216 12.0088 2.00445 12.0084C2.55673 12.0079 3.00351 12.4566 3.06526 13.0055C3.27138 14.8374 4.03712 16.5706 5.27027 17.9625C6.7255 19.605 8.73118 20.6586 10.9094 20.9247C13.0876 21.1909 15.288 20.6513 17.0959 19.4075C18.9039 18.1638 20.1945 16.3018 20.7247 14.1724C21.2549 12.043 20.9881 9.79319 19.9745 7.8469C18.9608 5.90061 17.2704 4.3922 15.2217 3.6059C13.173 2.8196 10.9074 2.80968 8.8519 3.57803C7.11008 4.22911 5.62099 5.40094 4.57993 6.92229C4.56156 6.94914 4.54217 6.97505 4.52185 7Z");
          path.setAttribute("fill", "currentColor");
          svg.appendChild(path);
          btn.appendChild(svg);

          entry._clearBtn = btn;

          btn.addEventListener("click", () => {
            const allBtns = doc.querySelectorAll("#zotero-tag-selector .tag-quick-filter-btn");
            allBtns.forEach(b => b.classList.remove("active"));
            entry.activeLetter = null;
            this._updateClearBtn(entry);
            this._triggerRefresh(win.ZoteroPane?.tagSelector);
          });

        } else {
          btn.textContent = item;
          btn.dataset.letter = item;

          btn.addEventListener("click", () => {
            this._onLetterClick(win, entry, item, btn, doc);
          });
        }

        rowEl.appendChild(btn);
      }

      quickFilter.appendChild(rowEl);
    }

    filterPane.insertAdjacentElement("afterend", quickFilter);

    win.setTimeout(() => {
      const tagSelector = win.ZoteroPane?.tagSelector;
      if (tagSelector?.handleResize) {
        tagSelector.handleResize();
      }
    }, 100);
  }

  _updateClearBtn(entry) {
    if (!entry._clearBtn) return;
    if (entry.activeLetter) {
      entry._clearBtn.classList.add("has-filter");
    } else {
      entry._clearBtn.classList.remove("has-filter");
    }
  }

  _onLetterClick(win, entry, letter, btn, doc) {
    const allBtns = doc.querySelectorAll(
      "#zotero-tag-selector .tag-quick-filter-btn"
    );
    const tagSelector = win.ZoteroPane?.tagSelector;
    if (!tagSelector) return;

    if (entry.activeLetter === letter) {
     entry.activeLetter = null;
      allBtns.forEach(b => b.classList.remove("active"));
      this._updateClearBtn(entry);
      this._triggerRefresh(tagSelector);
      return;
    }

    entry.activeLetter = letter;
    allBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    this._updateClearBtn(entry);
    this._triggerRefresh(tagSelector);
  }

  _triggerRefresh(tagSelector) {
    if (!tagSelector) return;
    tagSelector.getTagsAndScope().then(result => {
      tagSelector.setState({
        tags: result.tags,
        scope: result.scope,
      });
    }).catch(e => {
      Zotero.logError(e);
    });
  }

  _getPinyinFirstLetter(char) {
    const collator = new Intl.Collator("zh-Hans-CN", { sensitivity: "base" });
    const boundaries = {
      'A': '啊', 'B': '芭', 'C': '擦', 'D': '搭',
      'E': '蛾', 'F': '发', 'G': '噶', 'H': '哈',
      'J': '击', 'K': '喀', 'L': '垃', 'M': '妈',
      'N': '拿', 'O': '哦', 'P': '啪', 'Q': '期',
      'R': '然', 'S': '撒', 'T': '塌', 'W': '挖',
      'X': '昔', 'Y': '压', 'Z': '匝'
    };
    const letters = ['A','B','C','D','E','F','G','H','J','K','L','M','N','O','P','Q','R','S','T','W','X','Y','Z'];
    for (let i = letters.length - 1; i >= 0; i--) {
      if (collator.compare(char, boundaries[letters[i]]) >= 0) {
        return letters[i];
      }
    }
    return null;
  }

  _getFirstLetter(tag) {
    if (!tag || tag.length === 0) return null;
    const first = tag[0];
    if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
    if (/[\u4e00-\u9fa5]/.test(first)) return this._getPinyinFirstLetter(first);
    return null;
  }

  _setupMutationObserver(win, entry, container) {
    if (entry.mutationObserver) entry.mutationObserver.disconnect();

    const mutationObserver = new win.MutationObserver(() => {
      if (entry._pendingRaf) return;
      entry._pendingRaf = win.requestAnimationFrame(() => {
        entry._pendingRaf = null;
        const doc = win.document;
        const c = doc.querySelector("#zotero-tag-selector .tag-selector");
        const fp = doc.querySelector("#zotero-tag-selector .tag-selector-filter-pane");
        if (c && fp && c.firstElementChild !== fp) {
          this._moveFilterPaneToTop(doc, win, entry, c, fp);
        }
      });
    });

    mutationObserver.observe(container, { childList: true, subtree: false });
    entry.mutationObserver = mutationObserver;
  }
}