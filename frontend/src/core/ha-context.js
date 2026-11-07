export const getHaRoot = () =>
  document.querySelector("home-assistant") || document.querySelector("hc-main");
export const getHass = () => getHaRoot()?.hass ?? document.querySelector("hc-main")?.hass;

export function observeHaContexts({ root, contextTarget, contexts, onChange }) {
  let disposed = false;
  let queued = false;
  const subscriptions = new Set();
  const release = (unsubscribe) => {
    void Promise.resolve()
      .then(unsubscribe)
      .catch(() => {});
  };
  for (const context of contexts) {
    const request = new Event("context-request", { bubbles: true, composed: true });
    Object.assign(request, {
      context,
      contextTarget,
      subscribe: true,
      callback: (_value, unsubscribe) => {
        if (typeof unsubscribe !== "function") return;
        if (disposed) {
          release(unsubscribe);
          return;
        }
        subscriptions.add(unsubscribe);
        if (queued) return;
        queued = true;
        void Promise.resolve().then(() => {
          queued = false;
          if (!disposed) onChange();
        });
      },
    });
    root?.dispatchEvent(request);
  }
  return () => {
    disposed = true;
    for (const unsubscribe of subscriptions) release(unsubscribe);
    subscriptions.clear();
  };
}

export function connectHaContext(host, getHaRoot) {
  // Our modals live under body, outside HA's context-provider subtree.
  host.addEventListener("context-request", (event) => {
    const ha = getHaRoot();
    if (!ha) return;
    event.stopPropagation();
    const request = new Event("context-request", { bubbles: true, composed: true });
    Object.assign(request, {
      context: event.context,
      contextTarget: event.contextTarget || event.composedPath()[0],
      callback: event.callback,
      subscribe: event.subscribe,
    });
    ha.dispatchEvent(request);
  });
}
