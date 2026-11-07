import { newId } from "../utils/ids.js";
import { currentPageUrl as pageUrl } from "../utils/urls.js";

const STATE_KEY = "quick_access_navigation_v1";

/** Same-document history only. HA owns routing and all non-Quick Access state. */
export function createNavigationHistory({ read, restore, needsGuard, guard }) {
  let session = null;
  let applying = false;
  let scheduled = false;
  let disposed = true;
  let disabled = false;
  let recovering = false;
  let pending = null;
  const retired = new Map();
  const history = () => window.history;
  const marker = () => history()?.state?.[STATE_KEY];
  const key = (route) => JSON.stringify(route);
  const supported = () =>
    !disabled &&
    typeof history()?.pushState === "function" &&
    typeof history()?.replaceState === "function" &&
    typeof history()?.go === "function";
  const stateFor = (index) => ({
    session: session.id,
    index,
    entry: session.entries[index].id,
    url: session.url,
  });
  function isLocalMarker(value) {
    return (
      value &&
      typeof value.session === "string" &&
      typeof value.entry === "string" &&
      value.url === pageUrl() &&
      Number.isInteger(value.index) &&
      value.index >= 0 &&
      value.index < history().length
    );
  }

  function attempt(action) {
    try {
      action();
      return true;
    } catch (error) {
      disabled = true;
      session = pending = null;
      console.warn("[Quick Access] Browser history is unavailable.", error);
      return false;
    }
  }
  const go = (delta) => attempt(() => history().go(delta));
  function write(method, value) {
    const state = { ...history().state };
    if (value) state[STATE_KEY] = value;
    else delete state[STATE_KEY];
    // Omitting the URL preserves path, query and hash exactly.
    const written = attempt(() => history()[method](state, ""));
    if (written && session) session.length = history().length;
    return written;
  }
  function entryIndex() {
    const value = marker();
    if (
      !session ||
      !isLocalMarker(value) ||
      value.session !== session.id ||
      pageUrl() !== session.url
    )
      return -1;
    const entry = session.entries[value.index];
    return entry && value.entry === entry.id ? value.index : -1;
  }
  function travel(index, after = null) {
    const current = entryIndex();
    if (current < 0) return;
    if (index === current) {
      after?.();
      return;
    }
    pending = { session, index, after };
    go(index - current);
  }
  function apply(index) {
    const active = session;
    if (!active) return;
    active.index = index;
    applying = true;
    try {
      restore(active.entries[index].route);
    } finally {
      applying = false;
    }
    // Deleted records, hidden launchers or failed mounts can make a saved
    // destination unavailable. Reconcile to the visible ancestor in that case.
    sync();
  }
  function sync() {
    if (disposed || applying || scheduled || !supported()) return;
    scheduled = true;
    void Promise.resolve().then(() => {
      scheduled = false;
      commit();
    });
  }
  function commit() {
    if (disposed || applying || pending || recovering || !supported()) return;
    const route = read();
    if (!session) {
      if (!route) return;
      // Never take ownership of an HA dialog's entry.
      if (history().state?.dialog) return;
      session = {
        id: newId(),
        url: pageUrl(),
        index: 0,
        entries: [{ id: newId(), route: null }],
        browserIndex: window.navigation?.currentEntry?.index,
      };
      if (!write("replaceState", stateFor(0))) return;
    }
    const index = entryIndex();
    if (index < 0) return;
    if (key(route) === key(session.entries[index].route)) return;
    // UI Back, Cancel and dismissal reuse ancestors instead of pushing them.
    const ancestor = session.entries
      .slice(0, index)
      .findLastIndex((entry) => key(entry.route) === key(route));
    if (ancestor >= 0) {
      travel(ancestor, sync);
      return;
    }
    if (!route) return;
    const entry = { id: newId(), route };
    const previous = session.entries[index].route;
    if (
      previous?.menu &&
      !route.menu &&
      previous.view === route.view &&
      (route.modal?.key !== previous.modal?.key || route.category?.key !== previous.category?.key)
    ) {
      // An action consumes its transient menu; Back returns to the parent.
      session.entries[index] = entry;
      write("replaceState", stateFor(index));
      return;
    }
    session.entries.splice(index + 1, session.entries.length, entry);
    session.index = index + 1;
    write("pushState", stateFor(session.index));
  }
  function onPop() {
    if (disposed) return;
    const index = entryIndex();
    if (index < 0) {
      skipRetired();
      if (recovering && marker()?.index === 0) {
        recovering = false;
        sync();
      }
      return;
    }
    if (pending) {
      // Other queued Back presses can land before our own traversal. Only the
      // requested destination may render or open a discard confirmation.
      if (pending.session !== session) return;
      if (index !== pending.index) {
        // WebView/Chromium can supersede a queued history.go with a newer Back.
        // Rebase the outstanding traversal on the entry that actually landed.
        go(pending.index - index);
        return;
      }
      const after = pending.after;
      pending = null;
      session.index = index;
      after?.();
      sync();
      return;
    }
    const previous = session.index;
    if (index === previous) return;
    const route = session.entries[index].route;
    if (needsGuard(route)) {
      // popstate is not cancelable. Restore our entry before prompting, keeping
      // the original DOM/draft alive and leaving Forward history intact.
      const active = session;
      travel(previous, () =>
        guard(route, () => {
          if (session !== active || disposed) return;
          travel(index, () => apply(index));
        }),
      );
    } else apply(index);
  }
  function skipRetired() {
    const value = marker();
    if (!isLocalMarker(value)) return;
    if (!retired.has(value.session)) {
      // Entries from unloaded/user-changed sessions must never resurrect UI.
      retired.set(value.session, { url: value.url, index: value.index + 1, boundary: 0 });
    }
    const old = retired.get(value.session);
    if (pageUrl() !== old.url) return;
    if (value.index === 0) {
      old.index = 0;
      return;
    }
    const forward = old.index === 0 || value.index > old.index;
    old.index = value.index;
    const target = forward ? old.boundary : 0;
    if (target !== value.index) go(target - value.index);
  }
  function routeChanged() {
    if (!session || pageUrl() === session.url) return;
    // The committed HA entry is already current. Never rewind or replay it.
    // Remember only the size of our old segment so subsequent Back skips it.
    const value = marker();
    const browserIndex = window.navigation?.currentEntry?.index;
    const copied = value?.session === session.id;
    const replaced =
      Number.isInteger(browserIndex) && Number.isInteger(session.browserIndex)
        ? browserIndex === session.browserIndex + session.index
        : copied && history().length <= session.length;
    retired.set(session.id, {
      url: session.url,
      index: session.index + 1,
      boundary: session.index + (replaced ? 0 : 1),
    });
    if (copied) write("replaceState", null);
    session = null;
    pending = null;
  }
  return {
    sync,
    commit,
    routeChanged,
    start(signal) {
      disposed = false;
      disabled = false;
      window.addEventListener("popstate", onPop, { signal });
      // Reloaded entries have no in-memory UI session. Collapse only our own
      // segment, never attempt to recreate HA state or serialize editor drafts.
      const value = marker();
      if (supported() && isLocalMarker(value) && value.index > 0) {
        retired.set(value.session, { url: pageUrl(), index: value.index + 1, boundary: 0 });
        recovering = true;
        go(-value.index);
      }
    },
    dispose() {
      disposed = true;
      recovering = false;
      pending = null;
      if (session && entryIndex() > 0) go(-entryIndex());
      session = null;
      retired.clear();
    },
  };
}
