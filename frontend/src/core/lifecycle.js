// Own the long-lived activation subscription independently of mounted UI.
export function createLifecycle({ getHass, onStatus, onReady, onConnectedStatus }) {
  const BOOTSTRAP_POLL_MS = 350;
  let disposed = false;
  let started = false;
  let loader = null;
  const SUBSCRIBE_RETRY_MS = 5000;
  const LIFECYCLE_TIMEOUT_MS = 10000;
  let lifecycleRequest = null;
  let lifecycleEpoch = 0;
  let lifecycleError = "";
  let lifecycleConnection = null;
  let lifecycleUnsubscribe = null;
  let retryAfter = 0;
  function handleConnectionReady() {
    lifecycleRequest?.abort();
    lifecycleRequest = null;
    lifecycleEpoch++;
    onReady();
    retryAfter = 0;
    if (!loader) loader = setInterval(pollLifecycle, BOOTSTRAP_POLL_MS);
    void connectLifecycle();
  }

  function releaseLifecycleSubscription(unsubscribe) {
    if (unsubscribe)
      void Promise.resolve()
        .then(unsubscribe)
        .catch(() => {});
  }

  async function connectLifecycle() {
    const hass = getHass();
    if (
      disposed ||
      lifecycleRequest ||
      Date.now() < retryAfter ||
      !hass?.user?.id ||
      !hass.states ||
      !hass.connection ||
      hass.connection.connected === false
    )
      return;
    const request = new AbortController();
    lifecycleRequest = request;
    const epoch = ++lifecycleEpoch;
    const connection = hass.connection;
    const user = hass.user.id;
    const isCurrent = () =>
      !disposed &&
      !request.signal.aborted &&
      epoch === lifecycleEpoch &&
      getHass()?.user?.id === user &&
      getHass()?.connection === connection;
    lifecycleConnection?.removeEventListener("ready", handleConnectionReady);
    const unsubscribe = lifecycleUnsubscribe;
    lifecycleUnsubscribe = null;
    lifecycleConnection = connection;
    connection.addEventListener("ready", handleConnectionReady);
    let timeout;
    let nextUnsubscribe = null;
    let abortRequest;
    let receiveStatus;
    const initialStatus = new Promise((resolve) => {
      receiveStatus = resolve;
    });
    try {
      await Promise.race([
        (async () => {
          await unsubscribe?.();
          if (!isCurrent()) return;
          // Keep the UI during disconnects. Only a current server status can
          // deactivate it, including after an interrupted startup or reconnect.
          const stop = await connection.subscribeMessage(
            (value) => {
              if (!isCurrent()) return;
              onStatus(value);
              receiveStatus();
              onConnectedStatus();
            },
            { type: "quick_access/subscribe_status" },
            { resubscribe: false },
          );
          if (!isCurrent()) {
            releaseLifecycleSubscription(stop);
            return;
          }
          nextUnsubscribe = stop;
          await initialStatus;
        })(),
        new Promise((resolve, reject) => {
          abortRequest = () => reject(new Error("Integration status request superseded"));
          request.signal.addEventListener("abort", abortRequest, { once: true });
          timeout = setTimeout(
            () => reject(new Error("Integration status request timed out")),
            LIFECYCLE_TIMEOUT_MS,
          );
        }),
      ]);
      if (!isCurrent()) return;
      lifecycleUnsubscribe = nextUnsubscribe;
      lifecycleError = "";
      onConnectedStatus();
      clearInterval(loader);
      loader = null;
    } catch (error) {
      if (!isCurrent()) return;
      request.abort();
      connection.removeEventListener("ready", handleConnectionReady);
      lifecycleConnection = null;
      lifecycleError = error?.message || String(error);
      retryAfter = Date.now() + SUBSCRIBE_RETRY_MS;
      if (!loader) loader = setInterval(pollLifecycle, BOOTSTRAP_POLL_MS);
      console.warn("[Quick Access] Could not subscribe to integration status; retrying.", error);
    } finally {
      clearTimeout(timeout);
      if (abortRequest) request.signal.removeEventListener("abort", abortRequest);
      if (!isCurrent()) {
        request.abort();
        releaseLifecycleSubscription(nextUnsubscribe);
      }
      if (lifecycleRequest === request) lifecycleRequest = null;
    }
  }

  let attempts = 0;
  function pollLifecycle() {
    void connectLifecycle();
    if (++attempts === 85) {
      console.warn(
        "[Quick Access] Still waiting for Home Assistant and integration status. Run quickAccessDebug() in the console for details.",
      );
    }
  }
  return {
    start() {
      if (disposed || started) return;
      started = true;
      loader = setInterval(pollLifecycle, BOOTSTRAP_POLL_MS);
    },
    refresh() {
      if (disposed) return;
      if (!loader) loader = setInterval(pollLifecycle, BOOTSTRAP_POLL_MS);
      void connectLifecycle();
    },
    get subscribed() {
      return Boolean(lifecycleUnsubscribe);
    },
    get pending() {
      return Boolean(lifecycleRequest);
    },
    get error() {
      return lifecycleError;
    },
    dispose() {
      disposed = true;
      lifecycleEpoch++;
      lifecycleRequest?.abort();
      lifecycleRequest = null;
      clearInterval(loader);
      loader = null;
      lifecycleConnection?.removeEventListener("ready", handleConnectionReady);
      lifecycleConnection = null;
      releaseLifecycleSubscription(lifecycleUnsubscribe);
      lifecycleUnsubscribe = null;
    },
  };
}
