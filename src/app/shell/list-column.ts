import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { Navigation } from "../../features/navigation/controller";
import type { OpenTarget } from "../../features/navigation/targets";
import { isSidebarSectionRoute } from "../../features/channel-navigation/sidebar-section-route";
import { soloDraft } from "../../features/channel-navigation/routes";

/** Pages whose content is a conversation, a draft of one, or a section's home. */
export function listsConversations(target: OpenTarget) {
  return (
    target.kind === "conversation" ||
    (target.kind === "page" &&
      target.pluginId === "buzz.channels" &&
      target.pageId === "channels")
  );
}

/**
 * The section a page route names: "Open Team" and "Open Solo" are addresses,
 * and the conversations page without a route is Team's.
 */
export function routedSection(target: OpenTarget) {
  if (target.kind !== "page" || !listsConversations(target)) return;
  if (!target.route) return "messages";
  const params = target.route.params;
  return isSidebarSectionRoute(params) ? params.section : undefined;
}

/** A draft's own section, so its list opens on the collection it adds to. */
function draftSection(target: OpenTarget) {
  if (target.kind !== "page" || !listsConversations(target)) return;
  const params = target.route?.params;
  return params === "new-message" || params === "compose"
    ? "messages"
    : soloDraft(params)
      ? "solo"
      : undefined;
}

export type ListColumn = {
  /** Whether the list is shown beside the page. */
  open: boolean;
  /** The section it lists. Unset: the one the open conversation belongs to. */
  section: string | undefined;
  /** A person toggled it: the change may animate. */
  animate: boolean;
};
type Saved = Pick<ListColumn, "open" | "section">;

const closed: ListColumn = { open: false, section: undefined, animate: false };

/**
 * The one owner of the list column's state. A visit keeps the list as the
 * previous one left it, with three exceptions: a section address opens that
 * section, traversal restores what the visit last showed, and the sidebar
 * closes it before opening a destination directly.
 */
export function useListColumn(navigator: Navigation | undefined) {
  const visit = useSyncExternalStore(
    navigator?.subscribe ?? noSubscription,
    () => navigator?.snapshot(),
  );
  const entryId = visit?.entry.id;
  const saved = useRef(new Map<string, Saved>());
  const [state, setState] = useState<{
    entryId: string | undefined;
    list: ListColumn;
  }>({ entryId: undefined, list: closed });
  let list = state.list;
  if (state.entryId !== entryId) {
    const target = visit?.entry.target;
    const section = target && routedSection(target);
    const prior = entryId ? saved.current.get(entryId) : undefined;
    list =
      visit?.attempt.traversal && prior
        ? { ...prior, animate: false }
        : section
          ? { open: true, section, animate: false }
          : {
              open: state.list.open,
              section: (target && draftSection(target)) ?? state.list.section,
              animate: false,
            };
    setState({ entryId, list });
  }
  if (entryId) remember(saved.current, entryId, list);
  const setOpen = useCallback(
    (open: boolean, animate = false) =>
      setState((current) => ({
        ...current,
        list: { ...current.list, open, animate },
      })),
    [],
  );
  /** The sidebar opens a destination directly: no list, no remembered section. */
  const reset = useCallback(
    () => setState((current) => ({ ...current, list: closed })),
    [],
  );
  return { list, setOpen, reset };
}

function remember(saved: Map<string, Saved>, entryId: string, list: Saved) {
  saved.delete(entryId);
  saved.set(entryId, { open: list.open, section: list.section });
  if (saved.size > 100) {
    const first = saved.keys().next().value;
    if (first) saved.delete(first);
  }
}

const noSubscription = () => () => {};
