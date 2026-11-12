import type { RailLayout } from "./rail-layout";
import type { RailEntry } from "./rail-pins";

export type RailSection = { id: string; title: string };
const builtins: readonly RailSection[] = [
  { id: "navigation", title: "Plugins" },
  { id: "pins", title: "Pins" },
  { id: "messages", title: "Team" },
  { id: "solo", title: "Solo" },
  { id: "agents", title: "Agents" },
];

/** Cards, expanded lists and conversation routing share the same membership. */
export function railSections(
  layout: RailLayout,
  contributions: readonly RailSection[] = [],
) {
  const sections = new Map(
    [...builtins, ...contributions, ...layout.sections].map((section) => [
      section.id,
      section.title,
    ]),
  );
  const assigned = new Map(
    layout.placements
      .filter((item) => sections.has(item.section))
      .map((item) => [item.entry.id, item.section]),
  );
  const placed = new Map<string, RailEntry[]>();
  for (const { entry, section } of layout.placements) {
    if (!sections.has(section)) continue;
    const entries = placed.get(section) ?? [];
    entries.push(entry);
    placed.set(section, entries);
  }
  return {
    sections,
    assigned,
    entries(
      id: string,
      defaults: readonly RailEntry[],
      current?: ReadonlyMap<string, RailEntry>,
    ) {
      const entries = new Map(
        defaults
          .filter(
            (entry) =>
              id === "agents" ||
              !assigned.has(entry.id) ||
              assigned.get(entry.id) === id,
          )
          .map((entry) => [entry.id, entry]),
      );
      for (const entry of placed.get(id) ?? [])
        entries.set(entry.id, current?.get(entry.id) ?? entry);
      return [...entries.values()];
    },
    owner(matches: (entry: RailEntry) => boolean) {
      return layout.placements.find(
        (item) => sections.has(item.section) && matches(item.entry),
      )?.section;
    },
  };
}
