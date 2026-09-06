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
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const roleMap = {
      a: 'link',
      button: 'button',
      input: 'textbox',
      textarea: 'textbox',
      select: 'combobox',
      option: 'option',
      img: 'img',
      h1: 'heading',
      h2: 'heading',
      h3: 'heading',
    };
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
    }
    return roleMap[tag] || null;
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

  function generateSelector(el) {
    if (!(el instanceof Element)) {
      return { selector: null, selectorType: null };
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
        return {
          selector: name,
          selectorType: 'role',
          role,
          cssEquivalent: `role=${role}[name="${name}"]`,
        };
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
  root.__PW_REC__.selectorEngine = { generateSelector, getVisibleText, getAccessibleRole };
})();
