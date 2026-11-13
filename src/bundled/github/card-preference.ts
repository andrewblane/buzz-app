import { useSyncExternalStore } from "react";

const key = "buzz.github.show-link-previews.v1";
const changed = "buzz-github-card-preference-changed";

/** Viewer choice on this device; message content is never changed. */
export function showGitHubCards(): boolean {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}

export function setShowGitHubCards(enabled: boolean): void {
  localStorage.setItem(key, enabled ? "on" : "off");
  window.dispatchEvent(new Event(changed));
}

export function subscribeGitHubCards(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener(changed, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", storage);
  };
}

export function useShowGitHubCards() {
  return useSyncExternalStore(subscribeGitHubCards, showGitHubCards);
}
