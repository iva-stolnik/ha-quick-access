import { createLauncher } from "./launcher/launcher-controller.js";

// HA can load the resource again during entry reloads. Keep one lifecycle owner.
if (!window.__quickAccessLoaded) {
  window.__quickAccessLoaded = true;
  createLauncher().start();
}
