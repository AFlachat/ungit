const ko = require('knockout');
const components = require('ungit-components');

components.register('contextMenu', (args) => new ContextMenuViewModel(args));

const MARGIN = 8;
const SUBMENU_WIDTH = 200;

// Labels are HTML built by menuItems.js (ref names already escaped); ids are fixed identifiers.
const renderItems = (items) =>
  items
    .map((it) => {
      if (it === 'separator') return '<div class="modern-ctx-sep"></div>';
      const cls = ['modern-ctx-item'];
      if (it.danger) cls.push('danger');
      const attrs = `data-ta-action="${it.id}"`;
      if (it.children) {
        cls.push('modern-ctx-sub');
        return `<div class="${cls.join(' ')}" ${attrs}>${it.label}<div class="modern-ctx-subm">${renderItems(it.children)}</div></div>`;
      }
      return `<div class="${cls.join(' ')}" ${attrs}>${it.label}</div>`;
    })
    .join('');

class ContextMenuViewModel {
  constructor({ repo }) {
    this.repo = repo;
    this.isOpen = ko.observable(false);
    this.html = ko.observable('');
    this._onSelect = null;
    this._el = null;
    this._listeners = [];
    this.onClick = this.onClick.bind(this);
    this.close = this.close.bind(this);
  }

  updateNode(parentElement) {
    ko.renderTemplate(
      'contextMenu',
      this,
      {
        afterRender: (nodes) => {
          this._el = nodes.find((n) => n.nodeType === 1 && n.classList.contains('modern-ctx'));
        },
      },
      parentElement
    );
  }

  open(x, y, items, onSelect) {
    this.close();
    if (!this._el || !items || !items.length) return;
    this._onSelect = onSelect;
    this.html(renderItems(items));
    this.isOpen(true);
    const el = this._el;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN))}px`;
    el.style.top = `${Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN))}px`;
    const left = parseFloat(el.style.left);
    el.classList.toggle('flip', left + rect.width + SUBMENU_WIDTH > window.innerWidth);
    this._listen();
  }

  close() {
    this._unlisten();
    this._onSelect = null;
    if (this.isOpen.peek()) this.isOpen(false);
  }

  _listen() {
    const add = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push(() => target.removeEventListener(type, fn, opts));
    };
    add(
      document,
      'mousedown',
      (e) => {
        if (!this._el || !this._el.contains(e.target)) this.close();
      },
      true
    );
    add(
      document,
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      },
      true
    );
    add(
      document,
      'scroll',
      (e) => {
        if (!this._el || !this._el.contains(e.target)) this.close();
      },
      true
    );
    add(window, 'resize', this.close);
    add(window, 'blur', this.close);
  }

  _unlisten() {
    this._listeners.forEach((off) => off());
    this._listeners = [];
  }

  onInnerContextMenu() {
    return false; // keep the browser menu away from our menu
  }

  onClick(data, event) {
    const target = event.target.closest && event.target.closest('[data-ta-action]');
    if (!target || !this._el.contains(target)) return false;
    if (target.classList.contains('modern-ctx-sub')) {
      // sub-menu parent: opens on hover, and on click for keyboard/touch
      target.classList.toggle('open');
      return false;
    }
    const id = target.getAttribute('data-ta-action');
    const onSelect = this._onSelect;
    this.close();
    if (onSelect) onSelect(id);
    return false;
  }
}

module.exports = ContextMenuViewModel;
