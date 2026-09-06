/**
 * selector-engine.js
 * Generates resilient element selectors following the priority:
 *   1. data-testid / other data-* automation attributes
 *   2. id attribute (if unique in document)
 *   3. aria-role/aria-label + visible text
 *   4. unique CSS path (nth-of-type chain)
 *   5. XPath fallback
 *
 * Exposed on globalThis.__PW_REC__.selectorEngine so it can be used from the
 * plain (non-module) content script injected via chrome.scripting.
 */
(function () {
  const TESTID_ATTRS = [
    'data-testid',
    'data-test-id',
    'data-test',
    'data-qa',
    'data-cy',
    'data-automation-id',
  ];

  function isUniqueInDocument(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  function cssEscape(value) {
    const root = typeof globalThis !== 'undefined' ? globalThis : self;
    if (root.CSS && root.CSS.escape) return root.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function getVisibleText(el) {
    const text = (el.innerText || el.textContent || el.value || '').trim();
    return text.replace(/\s+/g, ' ').slice(0, 80);
  }

  function getAccessibleRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.trim().split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    const roleMap = {
      a: 'link',
      button: 'button',
      input: 'textbox',
      textarea: 'textbox',
      select: 'combobox',
      option: 'option',
      optgroup: 'group',
      li: 'listitem',
      ul: 'list',
      ol: 'list',
      nav: 'navigation',
      main: 'main',
      header: 'banner',
      footer: 'contentinfo',
      form: 'form',
      table: 'table',
      thead: 'rowgroup',
      tbody: 'rowgroup',
      tr: 'row',
      td: 'cell',
      th: 'columnheader',
      dialog: 'dialog',
      img: 'img',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
      h4: 'heading',
      h5: 'heading',
      h6: 'heading',
    };
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
    }
    return roleMap[tag] || implicitListItemRole(el) || null;
  }

  // -------------------------------------------------------------------------
  // Custom dropdown (listbox / menu / tree / tablist) support.
  //
  // Rich dropdowns (MUI, Ant, React-Select, Mantine, ...) render their options
  // as plain <div>/<li>/icon nodes inside a [role=listbox] style container,
  // often populating them lazily while the user scrolls the list. A CSS
  // :nth-of-type path recorded against such a list is positional and breaks
  // as soon as options are added/removed, so we resolve clicks to the actual
  // "item" node and prefer resilient role + text selectors for it.
  // -------------------------------------------------------------------------

  const LIST_OWNER_ROLES = ['listbox', 'menu', 'tree', 'grid', 'tablist', 'radiogroup'];
  const ITEM_ROLE_FOR_OWNER = {
    listbox: 'option',
    menu: 'menuitem',
    tree: 'treeitem',
    grid: 'gridcell',
    tablist: 'tab',
    radiogroup: 'radio',
  };
  const OWNER_SELECTOR = LIST_OWNER_ROLES.map((r) => `[role="${r}"]`).join(', ');

  function listOwnerFor(el) {
    if (!(el instanceof Element) || typeof el.closest !== 'function') return null;
    try {
      const owner = el.closest(OWNER_SELECTOR);
      if (!owner || owner === el) return null;
      return owner.contains(el) ? owner : null;
    } catch (e) {
      return null;
    }
  }

  /** Implicit role for role-less nodes inside a dropdown list container. */
  function implicitListItemRole(el) {
    if (el instanceof Element && el.getAttribute('role')) return null;
    const owner = listOwnerFor(el);
    if (!owner) return null;
    // Only direct-ish children of the list behave as items; deeper nodes keep
    // their generic role and nearestDropdownItem() climbs to the item instead.
    let n = el;
    while (n && n.parentElement && n.parentElement !== owner) n = n.parentElement;
    return n && n.parentElement === owner ? ITEM_ROLE_FOR_OWNER[owner.getAttribute('role').trim()] || null : null;
  }

  /**
   * Given any node inside a dropdown list, return the element that plays the
   * "item" part (the node with an explicit item role, or the owner's direct
   * child). Returns null when the node is not inside such a list.
   */
  function nearestDropdownItem(el) {
    if (!(el instanceof Element)) return null;
    const owner = listOwnerFor(el);
    if (!owner) return null;
    let n = el;
    while (n && n !== owner) {
      const role = n.getAttribute ? n.getAttribute('role') : null;
      if (role) {
        const first = role.trim().split(/\s+/)[0];
        if (ITEM_ROLE_FOR_OWNER[first] || first === 'option') return n;
      }
      n = n.parentElement;
    }
    // No explicitly-rolled ancestor: the owner's direct child containing el.
    n = el;
    while (n && n.parentElement && n.parentElement !== owner) n = n.parentElement;
    return n && n.parentElement === owner ? n : null;
  }

  /**
   * Find the combobox input that controls a given dropdown list container
   * (aria-controls / aria-owns pointing at it, or an expanded combobox in the
   * same wrapper). Used to attach context to option clicks so replay tools
   * know how the popup was opened.
   */
  function controllingCombobox(listEl) {
    if (!(listEl instanceof Element) || !listEl.id) return null;
    try {
      const byControls = document.querySelector(`[aria-controls="${cssEscape(listEl.id)}"], [aria-owns="${cssEscape(listEl.id)}"]`);
      if (byControls) return byControls;
    } catch (e) {
      /* non-escaping id; ignore */
    }
    return null;
  }

  /**
   * Anchor a shallow CSS path (one that became document-unique on its own) to
   * its dropdown list owner. "li:nth-of-type(8)" keeps matching while a lazy
   * list grows, but "#country-listbox li:nth-of-type(8)" also survives other
   * lists appearing on the page - a much stronger replay fallback.
   */
  function anchorToListOwner(el, cssPath) {
    if (!cssPath) return cssPath;
    const owner = listOwnerFor(el);
    if (!owner || !owner.contains(el)) return cssPath;
    let anchor = null;
    if (owner.id && /^[A-Za-z][\w-]*$/.test(owner.id)) {
      anchor = `#${cssEscape(owner.id)}`;
    } else {
      for (const attr of TESTID_ATTRS) {
        const value = owner.getAttribute(attr);
        if (value) {
          anchor = `[${attr}="${value.replace(/"/g, '\\"')}"]`;
          break;
        }
      }
    }
    if (!anchor) anchor = buildCssPath(owner);
    if (!anchor || cssPath.startsWith(anchor)) return cssPath;
    return `${anchor} ${cssPath}`;
  }


  function buildCssPath(el) {
    if (!(el instanceof Element)) return null;
    const path = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && path.length < 8) {
      let selector = node.tagName.toLowerCase();
      if (node.id) {
        selector = `#${cssEscape(node.id)}`;
        path.unshift(selector);
        break;
      } else {
        const classes = (node.className && typeof node.className === 'string')
          ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
          : [];
        if (classes.length) {
          selector += '.' + classes.map(cssEscape).join('.');
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (sib) => sib.tagName === node.tagName
          );
          if (siblings.length > 1) {
            const index = siblings.indexOf(node) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }
      }
      path.unshift(selector);
      if (isUniqueInDocument(path.join(' > '))) break;
      node = node.parentElement;
    }
    return path.join(' > ');
  }

  function buildXPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      const tag = node.tagName.toLowerCase();
      parts.unshift(`${tag}[${index}]`);
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  }

  function generateSelector(el, options) {
    if (!(el instanceof Element)) {
      return { selector: null, selectorType: null };
    }
    const opts = options || {};
    const tag = el.tagName.toLowerCase();

    // For plain (non-control) nodes inside a custom dropdown list, resolve to
    // the list item itself: clicking an icon/label inside an option means
    // clicking the option, and the option node has the stable selector.
    if (!opts.noItemResolve && !['input', 'select', 'textarea', 'button', 'a'].includes(tag)) {
      const item = nearestDropdownItem(el);
      if (item && item !== el) {
        const itemSel = generateSelector(item, { noItemResolve: true, ...opts });
        // Keep the originally clicked element's text around when it differs:
        // useful context for heavily nested options.
        const elText = getVisibleText(el);
        if (elText && elText !== getVisibleText(item)) {
          itemSel.meta = Object.assign({}, itemSel.meta, { clickedText: elText });
        }
        return itemSel;
      }
    }

    // 1. data-testid / data-* automation attributes
    for (const attr of TESTID_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) {
        const selector = `[${attr}="${value.replace(/"/g, '\\"')}"]`;
        if (isUniqueInDocument(selector)) {
          return { selector: value, selectorType: 'testid', rawAttr: attr, cssEquivalent: selector };
        }
      }
    }

    // 2. id attribute
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
      const selector = `#${cssEscape(el.id)}`;
      if (isUniqueInDocument(selector)) {
        return { selector: el.id, selectorType: 'id', cssEquivalent: selector };
      }
    }

    // 3. aria-role/label + visible text
    const role = getAccessibleRole(el);
    const ariaLabel = el.getAttribute('aria-label');
    const text = getVisibleText(el);
    if (role && (ariaLabel || text)) {
      const name = (ariaLabel || text).trim();
      if (name) {
        const result = {
          selector: name,
          selectorType: 'role',
          role,
          cssEquivalent: `role=${role}[name="${name}"]`,
        };
        // Role+text locators can miss when the accessible name is computed
        // differently at replay time (e.g. implicit listbox options). Attach a
        // positional CSS fallback the executor can retry with.
        if (opts.withFallback) {
          const fb = buildCssPath(el);
          if (fb) result.fallbackCss = anchorToListOwner(el, fb);
        }
        return result;
      }
    }

    // 4. unique CSS path
    const cssPath = buildCssPath(el);
    if (cssPath) {
      return { selector: cssPath, selectorType: 'css', cssEquivalent: cssPath };
    }

    // 5. XPath fallback
    const xpath = buildXPath(el);
    return { selector: xpath, selectorType: 'xpath', cssEquivalent: xpath };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.__PW_REC__ = root.__PW_REC__ || {};
  root.__PW_REC__.selectorEngine = {
    generateSelector,
    getVisibleText,
    getAccessibleRole,
    nearestDropdownItem,
    listOwnerFor,
    controllingCombobox,
  };
})();
