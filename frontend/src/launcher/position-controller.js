import { clamp } from "../utils/numbers.js";
export function createPositionController({
  l10n,
  ui,
  profiles,
  isInitialized,
  getDialog,
  hasProfile,
  evaluateVisibility,
  openDialog,
  saveJson,
  showStorageError,
  clearStorageError,
}) {
  const t = l10n.message;
  const UI_RETRY_MS = 5000;

  const { node, icon, button, leadingIcon, removeLocalizedElement } = ui;
  let savedPosition = null;
  let workingPosition = null;
  let keyboardPosition = null;
  let fab;
  let menu;
  let moveButton;
  let hold = null;
  let cancelKeyboardRelease = null;
  let buttonError = "";
  let buttonRetryAfter = 0;
  const FAB_SIZE = 48;
  const EDGE = 12;
  const HOLD_MS = 480;
  const KEYBOARD_MOVE_STEP = 10;
  const KEYBOARD_MOVE_FAST_STEP = 40;
  const FAB_DESCRIPTION = t("fab.description");
  const FAB_MOVE_DESCRIPTION = t("fab.move_description");
  function moveTo(left, top) {
    const x = clamp(left, EDGE, Math.max(EDGE, innerWidth - FAB_SIZE - EDGE));
    const y = clamp(top, EDGE, Math.max(EDGE, innerHeight - FAB_SIZE - EDGE));
    fab.style.left = `${x}px`;
    fab.style.top = `${y}px`;
    fab.style.right = "auto";
    fab.style.bottom = "auto";
    return {
      x: x / Math.max(1, innerWidth - FAB_SIZE),
      y: y / Math.max(1, innerHeight - FAB_SIZE),
    };
  }

  function applyPosition() {
    if (!fab) return;
    const position = workingPosition || savedPosition;
    if (!position) {
      fab.style.left = "auto";
      fab.style.top = "auto";
      fab.style.right =
        "calc(20px + var(--safe-area-inset-right, env(safe-area-inset-right, 0px)))";
      fab.style.bottom =
        "calc(24px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))";
      return;
    }
    // Keyboard/browser viewport changes must not replace the user's coordinates.
    moveTo(position.x * (innerWidth - FAB_SIZE), position.y * (innerHeight - FAB_SIZE));
  }

  function hideMenu(restoreFocus = false) {
    const hadFocus = menu?.contains(document.activeElement);
    if (menu) menu.hidden = true;
    fab?.setAttribute("aria-expanded", "false");
    if ((restoreFocus || hadFocus) && !fab?.hidden) fab?.focus({ preventScroll: true });
  }

  function showMenu(focus = false, pointerType) {
    if (pointerType !== undefined) moveButton.hidden = pointerType === "touch";
    const r = fab.getBoundingClientRect();
    menu.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    // Include the heading when measuring menu height.
    const width = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${clamp(r.right - width, EDGE, Math.max(EDGE, innerWidth - width - EDGE))}px`;
    menu.style.top = `${clamp(r.top > h + EDGE ? r.top - h - 10 : r.bottom + 10, EDGE, Math.max(EDGE, innerHeight - h - EDGE))}px`;
    if (focus)
      [...menu.querySelectorAll(".qap-menu-action")]
        .find((item) => !item.hidden && !item.disabled)
        ?.focus({ preventScroll: true });
  }

  function startKeyboardPosition() {
    if (!profiles.activeProfileId) return;
    keyboardPosition = {
      position: workingPosition ? { ...workingPosition } : null,
      storageKey: profiles.storageKey,
    };
    l10n.attribute(fab, "aria-description", FAB_MOVE_DESCRIPTION);
    fab.classList.add("qap-positioning");
    hideMenu(true);
  }

  function finishKeyboardPosition(save = false) {
    if (!keyboardPosition) return;
    const previous = keyboardPosition;
    keyboardPosition = null;
    fab.classList.remove("qap-positioning");
    l10n.attribute(fab, "aria-description", FAB_DESCRIPTION);
    if (previous.storageKey !== profiles.storageKey) return;
    if (save) savePosition();
    else {
      workingPosition = previous.position;
      applyPosition();
    }
  }

  function setupKeyboard() {
    let suppressedKey = null;
    let releaseTimer = null;
    cancelKeyboardRelease = () => {
      clearTimeout(releaseTimer);
      suppressedKey = null;
    };
    const consume = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    fab.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const activation = event.key === "Enter" || event.key === " ";
      if (!event.repeat && (activation || event.key === "F10")) {
        clearTimeout(releaseTimer);
        suppressedKey = null;
      }
      if (keyboardPosition) {
        if (activation || event.key === "Escape" || event.key.startsWith("Arrow")) {
          consume(event);
          if (activation) suppressedKey = event.key;
          if (event.key === "Enter" || event.key === "Escape") {
            finishKeyboardPosition(event.key === "Enter");
          } else if (event.key.startsWith("Arrow")) {
            const step = event.shiftKey ? KEYBOARD_MOVE_FAST_STEP : KEYBOARD_MOVE_STEP;
            const r = fab.getBoundingClientRect();
            let dx = 0;
            let dy = 0;
            switch (event.key) {
              case "ArrowRight":
                dx = step;
                break;
              case "ArrowLeft":
                dx = -step;
                break;
              case "ArrowDown":
                dy = step;
                break;
              case "ArrowUp":
                dy = -step;
                break;
            }
            workingPosition = moveTo(r.left + dx, r.top + dy);
          }
          return;
        }
      }
      if (event.shiftKey && (activation || event.key === "F10")) {
        consume(event);
        suppressedKey = event.key;
        if (!event.repeat) showMenu(true, "keyboard");
      } else if (event.key === "Escape" && !menu.hidden) {
        consume(event);
        hideMenu(true);
      } else if (activation && suppressedKey) consume(event);
      else if (activation) hideMenu();
    });
    // Space activates buttons on keyup. Focus may already have moved into the
    // menu, so suppress that default on both elements and the resulting click.
    const release = (event) => {
      if (event.key !== suppressedKey) return;
      consume(event);
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        suppressedKey = null;
      }, 0);
    };
    fab.addEventListener("keyup", release);
    menu.addEventListener("keyup", release, { capture: true });
    fab.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      if (suppressedKey || keyboardPosition || !menu.hidden || event.shiftKey) consume(event);
      else openDialog();
    });
    fab.addEventListener("blur", () => finishKeyboardPosition());
    menu.addEventListener("keydown", (event) => {
      if (event.repeat && event.key === suppressedKey) {
        consume(event);
        return;
      }
      if (!event.repeat && ["Enter", " ", "F10"].includes(event.key)) {
        clearTimeout(releaseTimer);
        suppressedKey = null;
      }
      if (event.key === "Escape") {
        consume(event);
        hideMenu(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      consume(event);
      const items = [...menu.querySelectorAll(".qap-menu-action")].filter(
        (item) => !item.hidden && !item.disabled,
      );
      const index = items.findIndex((item) => event.composedPath().includes(item));
      let next;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else {
        const step = event.key === "ArrowDown" ? 1 : -1;
        next = (index + step + items.length) % items.length;
      }
      items[next]?.focus({ preventScroll: true });
    });
    menu.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !menu.contains(event.relatedTarget)) hideMenu();
    });
  }

  function savePosition() {
    if (!profiles.activeProfileId) return;
    const r = fab.getBoundingClientRect();
    const position = {
      x: r.left / Math.max(1, innerWidth - FAB_SIZE),
      y: r.top / Math.max(1, innerHeight - FAB_SIZE),
    };
    if (!saveJson("position", position, "position")) {
      workingPosition = null;
      applyPosition();
      showMenu();
      showStorageError();
      return;
    }
    savedPosition = position;
    workingPosition = { ...position };
    clearStorageError();
    hideMenu();
  }

  function resetPosition() {
    if (!profiles.activeProfileId) return;
    try {
      localStorage.removeItem(`${profiles.storageKey}:position`);
    } catch (error) {
      console.warn("[Quick Access] Could not reset saved position", error);
      showStorageError();
      return;
    }
    savedPosition = null;
    workingPosition = null;
    clearStorageError();
    applyPosition();
    hideMenu();
  }

  function setupPointer() {
    fab.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || getDialog()) return;
      finishKeyboardPosition();
      hideMenu();
      const bounds = fab.getBoundingClientRect();
      hold = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
        held: false,
        dragged: false,
        cancelled: false,
        timer: null,
      };
      hold.timer = setTimeout(() => {
        if (!hold || hold.cancelled) return;
        hold.held = true;
        fab.classList.add("qap-holding");
      }, HOLD_MS);
      fab.setPointerCapture(event.pointerId);
    });
    fab.addEventListener("pointermove", (event) => {
      if (!hold || hold.id !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY);
      if (!hold.held && distance > 10) {
        hold.cancelled = true;
        clearTimeout(hold.timer);
      }
      if (hold.held && distance > 7) {
        hold.dragged = true;
        hideMenu();
        workingPosition = moveTo(event.clientX - hold.offsetX, event.clientY - hold.offsetY);
      }
    });
    const finish = (event, cancelled = false) => {
      if (!hold || hold.id !== event.pointerId) return;
      clearTimeout(hold.timer);
      const { held, dragged, cancelled: invalid } = hold;
      hold = null;
      fab.classList.remove("qap-holding");
      if (fab.hasPointerCapture(event.pointerId)) fab.releasePointerCapture(event.pointerId);
      if (cancelled) {
        workingPosition = null;
        applyPosition();
        hideMenu();
      } else if (held && dragged && !invalid) savePosition();
      else if (held && !dragged && !invalid) showMenu(false, event.pointerType || "mouse");
      if (!cancelled && !held && !dragged && !invalid) openDialog();
    };
    fab.addEventListener("pointerup", (event) => finish(event));
    fab.addEventListener("pointercancel", (event) => finish(event, true));
    fab.addEventListener("lostpointercapture", (event) => finish(event, true));
    fab.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function removeButton() {
    cancelKeyboardRelease?.();
    cancelKeyboardRelease = null;
    finishKeyboardPosition();
    clearTimeout(hold?.timer);
    hold = null;
    removeLocalizedElement(fab);
    removeLocalizedElement(menu);
    fab = null;
    menu = null;
    moveButton = null;
  }

  function ensureButton() {
    if (
      !isInitialized() ||
      (fab?.isConnected && menu?.isConnected) ||
      Date.now() < buttonRetryAfter
    )
      return;
    removeButton();
    try {
      fab = node("button");
      fab.id = "qap-fab";
      fab.type = "button";
      fab.hidden = true;
      l10n.attribute(fab, "aria-label", t("fab.open"));
      l10n.attribute(fab, "aria-description", FAB_DESCRIPTION);
      fab.setAttribute("aria-controls", "qap-menu");
      fab.setAttribute("aria-expanded", "false");
      l10n.property(fab, "title", t("fab.hold_to_move"));
      fab.append(icon("mdi:gesture-tap"));
      menu = node("div");
      menu.id = "qap-menu";
      menu.hidden = true;
      menu.setAttribute("role", "group");
      menu.setAttribute("aria-labelledby", "qap-menu-title");
      const menuTitle = node("h2", "qap-menu-title", t("launcher.title"));
      menuTitle.id = "qap-menu-title";
      moveButton = button(t("fab.move_button"), startKeyboardPosition, "qap-menu-action");
      l10n.attribute(moveButton, "aria-description", FAB_MOVE_DESCRIPTION);
      const reset = button(t("fab.reset_position"), resetPosition, "qap-menu-action");
      reset.prepend(leadingIcon("mdi:restore"));
      const reload = button(
        t("fab.reload_page"),
        () => window.location.reload(),
        "qap-menu-action",
      );
      reload.prepend(leadingIcon("mdi:reload"));
      menu.append(menuTitle, moveButton, reset, reload);
      document.body.append(fab, menu);
      setupPointer();
      setupKeyboard();
      applyPosition();
      updateVisibility();
      buttonError = "";
      buttonRetryAfter = 0;
    } catch (error) {
      removeButton();
      buttonError = error?.message || String(error);
      buttonRetryAfter = Date.now() + UI_RETRY_MS;
      console.warn("[Quick Access] Could not mount the floating button. Retrying.", error);
    }
  }

  function updateVisibility() {
    const { visible } = evaluateVisibility();
    if (fab) {
      if (keyboardPosition && (!visible || keyboardPosition.storageKey !== profiles.storageKey))
        finishKeyboardPosition();
      const setup = !hasProfile();
      l10n.attribute(fab, "aria-label", setup ? t("fab.setup") : t("fab.open"));
      l10n.property(fab, "title", setup ? t("fab.setup") : t("fab.hold_to_move"));
      fab.classList.toggle("qap-setup", setup);
      const setupLabel = fab.querySelector(".qap-fab-setup-label");
      if (setup && !setupLabel) {
        const label = node("span", "qap-fab-setup-label", t("fab.setup"));
        label.setAttribute("aria-hidden", "true");
        fab.append(label);
      } else if (!setup) removeLocalizedElement(setupLabel);
      fab.hidden = !visible;
      if (!visible) hideMenu();
      fab.classList.toggle("qap-dialog-open", Boolean(getDialog()));
    }
  }

  return {
    applyPosition,
    hideMenu,
    removeButton,
    ensureButton,
    updateVisibility,
    get fab() {
      return fab;
    },
    get menu() {
      return menu;
    },
    get keyboardPosition() {
      return keyboardPosition;
    },
    get buttonError() {
      return buttonError;
    },
    set buttonError(value) {
      buttonError = value;
    },
    get buttonRetryAfter() {
      return buttonRetryAfter;
    },
    set buttonRetryAfter(value) {
      buttonRetryAfter = value;
    },
    clear() {
      savedPosition = workingPosition = null;
    },
    load(position) {
      savedPosition = workingPosition = null;
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y))
        savedPosition = { x: clamp(position.x, 0, 1), y: clamp(position.y, 0, 1) };
    },
  };
}
