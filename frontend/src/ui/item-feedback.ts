const ITEM_HIGHLIGHT_DURATION = 2000;

/** View-owned feedback. Pending reveals only live as long as their owner. */
export function createItemFeedback(resolve: (id: string) => HTMLElement | undefined) {
  let id: string | undefined;
  let highlighted: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reveal = false;

  function clear() {
    clearTimeout(timer);
    timer = undefined;
    highlighted?.classList.remove("qap-drop-highlight");
    highlighted = undefined;
    id = undefined;
    reveal = false;
  }

  function refresh() {
    if (id === undefined) return;
    const item = resolve(id);
    if (item === highlighted && item?.isConnected) return;
    highlighted?.classList.remove("qap-drop-highlight");
    highlighted = item?.isConnected ? item : undefined;
    if (!highlighted) return;
    if (reveal) {
      const options: ScrollIntoViewOptions & { container: "nearest" } = {
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
        container: "nearest",
      };
      highlighted.scrollIntoView(options);
      reveal = false;
    }
    highlighted.classList.add("qap-drop-highlight");
    // Replacing a rendered row retains the original expiry.
    timer ??= setTimeout(clear, ITEM_HIGHLIGHT_DURATION);
  }

  return {
    refresh,
    clear,
    dispose: clear,
    show(itemId: string, scroll = false) {
      clear();
      id = itemId;
      reveal = scroll;
      refresh();
    },
  };
}
