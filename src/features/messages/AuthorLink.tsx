import type { ReactNode } from "react";
import styles from "./Messages.module.css";

/** A byline name that opens its author's profile. The avatar is the group's
 * keyboard stop and preview; the name only answers a click. Text, not a
 * button, so a selection can start on it and a copy keeps it as plain prose
 * (no profile target). */
export function AuthorLink({
  onOpen,
  children,
}: {
  onOpen(): void;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <button> would block starting a text selection on the name
    <span
      role="button"
      tabIndex={-1}
      data-message-author=""
      className={styles.authorLink}
      onClick={(event) => {
        // A click arriving with text selected (the end of a drag, or the
        // second click of a double-click) is a selection, not a request. A
        // double-click's first click opens the profile like any click.
        const selection = event.currentTarget.ownerDocument.getSelection();
        if (selection && !selection.isCollapsed) return;
        // WebKit skips focusing on pointer click, so the profile tab's close
        // would have no origin.
        event.currentTarget.focus();
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
    >
      {children}
    </span>
  );
}
