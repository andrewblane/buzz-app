import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  readView,
  subscribeView,
  viewRevision,
  writeView,
} from "../../shared/view-state";
import { parseRailEntries, type RailEntry } from "./rail-pins";

type Placement = { section: string; entry: RailEntry };
export type RailLayout = {
  order: string[];
  sections: { id: string; title: string }[];
  placements: Placement[];
};
const KEY = "navigation-layout:v2";

function readLayout(scope: string): RailLayout {
  const saved = readView<Partial<RailLayout> | null>(scope, KEY, null);
  const raw =
    saved ??
    readView<Partial<RailLayout> | null>(scope, "navigation-layout:v1", null);
  const sections = Array.isArray(raw?.sections)
    ? raw.sections.filter(
        (section) =>
          typeof section?.id === "string" &&
          section.id.startsWith("custom:") &&
          typeof section.title === "string" &&
          !!section.title.trim(),
      )
    : [];
  const placements: Placement[] = [];
  // Upgrade old Plugins assignments to the Team defaults. Subsequent moves
  // save under v2, so the person can still place these shortcuts elsewhere.
  if (Array.isArray(raw?.placements))
    for (const item of raw.placements) {
      const entry = parseRailEntries([item?.entry])[0];
      if (
        entry &&
        typeof item.section === "string" &&
        !placements.some((placed) => placed.entry.id === entry.id)
      )
        placements.push({
          section:
            !saved &&
            (item.section === "plugins" || item.section === "navigation") &&
            (entry.id === "buzz.inbox/inbox" ||
              entry.id === "buzz.drafts-and-sent/drafts-sent")
              ? "messages"
              : item.section === "plugins"
                ? "navigation"
                : item.section,
          entry,
        });
    }
  const order = Array.isArray(raw?.order)
    ? [...new Set(raw.order.filter((id) => typeof id === "string"))]
    : [];
  // The former plugin bucket lived in the fixed first card. Keep that card
  // first on upgrade, preserving the relative order of all movable sections.
  if (order.includes("plugins") && !order.includes("navigation"))
    order.unshift("navigation");
  return {
    order: order.filter((id) => id !== "plugins"),
    sections,
    placements,
  };
}

/** The rail's local arrangement never writes to a conversation or plugin's data. */
export function useRailLayout(scope: string) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeView(scope, listener),
    [scope],
  );
  const revision = useSyncExternalStore(
    subscribe,
    () => viewRevision(scope, KEY),
    () => undefined,
  );
  const layout = useMemo(
    () =>
      revision !== undefined
        ? readLayout(scope)
        : { order: [], sections: [], placements: [] },
    [scope, revision],
  );
  const save = (update: (current: RailLayout) => RailLayout) =>
    writeView(scope, KEY, update(readLayout(scope)));
  const move = (entry: RailEntry, section: string) =>
    save((current) => ({
      ...current,
      placements: [
        ...current.placements.filter((item) => item.entry.id !== entry.id),
        { section, entry },
      ],
    }));
  const reorder = (id: string, over: string, available: string[]) =>
    save((current) => {
      const order = [
        ...current.order.filter((key) => available.includes(key)),
        ...available.filter((key) => !current.order.includes(key)),
      ];
      const from = order.indexOf(id);
      const to = order.indexOf(over);
      if (from < 0 || to < 0) return current;
      order.splice(from, 1);
      order.splice(to, 0, id);
      return { ...current, order };
    });
  const create = (
    id: string,
    title: string,
    entry: RailEntry | undefined,
    available: string[],
  ) =>
    save((current) => ({
      ...current,
      sections: [...current.sections, { id: `custom:${id}`, title }],
      order: [
        ...current.order,
        ...available.filter((key) => !current.order.includes(key)),
        `custom:${id}`,
      ],
      placements: entry
        ? [
            ...current.placements.filter((item) => item.entry.id !== entry.id),
            { section: `custom:${id}`, entry },
          ]
        : current.placements,
    }));
  const reset = (entryId: string) =>
    save((current) => ({
      ...current,
      placements: current.placements.filter(
        (item) => item.entry.id !== entryId,
      ),
    }));
  const remove = (id: string) =>
    save((current) => ({
      ...current,
      order: current.order.filter((key) => key !== id),
      sections: current.sections.filter((section) => section.id !== id),
      placements: current.placements.filter((item) => item.section !== id),
    }));
  return {
    layout,
    move,
    reorder,
    create,
    remove,
    reset,
  };
}
