export function createDialogs({ l10n, ui }) {
  const { node, iconButton } = ui;
  const closingDialogs = new Map();
  function cancelRemoval(element) {
    const onClosed = closingDialogs.get(element);
    if (onClosed) element.removeEventListener("closed", onClosed);
    closingDialogs.delete(element);
  }
  function createDialogElement(label, forConfirmation = false) {
    const element = node("qap-dialog", forConfirmation ? "qap-dialog" : "qap-adaptive");
    l10n.attribute(element, "aria-label", label);
    element.setAttribute("without-header", "");
    element.setAttribute("flexcontent", "");
    element.setAttribute("width", forConfirmation ? "small" : "medium");
    element.adaptive = !forConfirmation;
    element.type = "standard";
    return element;
  }

  function showDialogElement(element, onClose) {
    // Guard the request before closing, keeping the exact surface and draft.
    element.addEventListener("cancel", (event) => {
      event.preventDefault();
      onClose();
    });
    document.body.append(element);
    element.showModal();
  }

  function createEditorDialog(title, closeLabel, onClose, className) {
    const modal = createDialogElement(title, true);
    modal.classList.add("qap-editor-dialog", className);
    const content = node("div", "qap-shell");
    const heading = node("div", "qap-head");
    heading.append(
      node("h2", "qap-title", title),
      iconButton("mdi:close", closeLabel, onClose, "qap-editor-close"),
    );
    const body = node("div", "qap-body qap-settings");
    content.append(heading, node("div", "qap-profile-status"), body);
    modal.append(content);
    return { modal, content, body };
  }

  function cleanupDialogElement(element) {
    if (!element || closingDialogs.has(element)) return;
    l10n.release(element);
    if (element.open || element.shadowRoot?.querySelector("dialog[open]")) {
      const onClosed = () => {
        cancelRemoval(element);
        if (!element.open) element.remove();
      };
      closingDialogs.set(element, onClosed);
      element.addEventListener("closed", onClosed, { once: true });
      element.close();
    } else element.remove();
  }

  return {
    createDialogElement,
    createEditorDialog,
    showDialogElement,
    cleanupDialogElement,
    cancelRemoval,
    dispose() {
      for (const element of closingDialogs.keys()) {
        cancelRemoval(element);
        element.remove();
      }
    },
  };
}
