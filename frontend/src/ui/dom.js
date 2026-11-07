export function createDom(l10n) {
  function node(tag, cls = "", text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) l10n.text(e, text);
    return e;
  }

  function removeLocalizedElement(element) {
    if (!element) return;
    l10n.release(element);
    element.remove();
  }

  function replaceLocalizedChildren(element, ...children) {
    for (const child of element.children) {
      if (!children.includes(child)) l10n.release(child);
    }
    element.replaceChildren(...children);
  }

  return { node, removeLocalizedElement, replaceLocalizedChildren };
}
