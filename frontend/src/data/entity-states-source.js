// HA owns snapshots. The mounted list owns the fixed update batch and diff index.
export function createEntityStatesSource({
  getHaRoot,
  contextTarget,
  onStates,
  poll,
  pollInterval,
}) {
  let disposed = false;
  let started = false;
  let unsubscribeStates = null;
  let timer = null;
  function release(unsubscribe) {
    if (typeof unsubscribe !== "function") return;
    // Provider teardown must not interrupt the mounted list's remaining cleanup.
    try {
      void Promise.resolve(unsubscribe()).catch(() => {});
    } catch {}
  }
  return {
    start() {
      if (disposed || started) return;
      started = true;
      if (pollInterval) timer = setInterval(poll, pollInterval);
      const request = new Event("context-request", { bubbles: true, composed: true });
      Object.assign(request, {
        context: "states",
        contextTarget,
        subscribe: true,
        callback: (states, unsubscribe) => {
          if (disposed) {
            release(unsubscribe);
            return;
          }
          if (!states || typeof states !== "object" || typeof unsubscribe !== "function") return;
          unsubscribeStates = unsubscribe;
          clearInterval(timer);
          timer = null;
          onStates(states);
        },
      });
      getHaRoot()?.dispatchEvent(request);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      release(unsubscribeStates);
      unsubscribeStates = null;
    },
  };
}
