// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { RailArrangement, RailGroup } from "./RailArrangement";
import { writeView } from "../../shared/view-state";
import type { RailEntry } from "./rail-pins";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

// Live component refreshes can retain an element's previous component identity.
// A real React wrapper exercises that boundary without mocking React's lifecycle.
test.each([false, true])(
  "row previews keep four objects with leading destinations: %s",
  (withLeading) => {
    const leading: RailEntry[] = withLeading
      ? ["activity", "drafts"].map((id) => ({
          id,
          label: id,
          kind: "page",
          target: {
            version: 1,
            kind: "page",
            pluginId: `example.${id}`,
            pageId: id,
          },
        }))
      : [];
    const entries: RailEntry[] = Array.from({ length: 6 }, (_, index) => ({
      id: `chat-${index}`,
      label: `Chat ${index + 1}`,
      kind: "chat",
      target: {
        version: 1,
        kind: "conversation",
        channelId: `chat-${index}`,
        scope: {
          viewer: "a".repeat(64),
          communityOrigin: "https://example.org",
        },
      },
    }));
    render(
      <RailArrangement
        partition="preview-test"
        selectedSection="solo"
        isPinned={() => false}
        onTogglePin={() => {}}
        openSection={() => {}}
        renderEntry={(entry) => <NavigationItem label={entry.label} />}
        sections={[
          {
            id: "solo",
            title: "Solo",
            content: (
              <RailGroup
                id="solo"
                title="Solo"
                leadingEntryIds={leading.map((entry) => entry.id)}
                rows={[...leading, ...entries].map((entry) => ({
                  entry,
                  content: <NavigationItem label={entry.label} />,
                }))}
              />
            ),
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Chat 4" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Chat 5" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat 6" })).toBeNull();
    const open = screen.getByRole("button", { name: "Open Solo" });
    expect(open.hasAttribute("data-selected")).toBe(false);
    expect(open.hasAttribute("aria-current")).toBe(false);
    if (withLeading) {
      const activity = screen.getByRole("button", {
        name: "activity",
      });
      const drafts = screen.getByRole("button", {
        name: "drafts",
      });
      expect(activity.compareDocumentPosition(drafts)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(
        drafts.compareDocumentPosition(
          screen.getByRole("button", { name: "Chat 1" }),
        ),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  },
);

test("saved Plugins shortcuts move to Team and can still be moved afterward", async () => {
  const entry: RailEntry = {
    id: "buzz.inbox/inbox",
    label: "Activity",
    kind: "page",
    target: {
      version: 1,
      kind: "page",
      pluginId: "buzz.inbox",
      pageId: "inbox",
    },
  };
  writeView("saved-shortcuts", "navigation-layout:v1", {
    order: ["navigation", "messages"],
    sections: [],
    placements: [{ section: "navigation", entry }],
  });
  const view = render(
    <RailArrangement
      partition="saved-shortcuts"
      isPinned={() => false}
      onTogglePin={() => {}}
      openSection={() => {}}
      renderEntry={(item) => <NavigationItem label={item.label} />}
      sections={["navigation", "messages"].map((id) => ({
        id,
        title: id === "navigation" ? "Plugins" : "Team",
        content: (
          <RailGroup
            id={id}
            title={id === "navigation" ? "Plugins" : "Team"}
            leadingEntryIds={id === "messages" ? [entry.id] : []}
            rows={
              id === "messages"
                ? [{ entry, content: <NavigationItem label={entry.label} /> }]
                : []
            }
          />
        ),
      }))}
    />,
  );
  const team = view.container.querySelector('[data-rail-section="messages"]');
  const plugins = view.container.querySelector(
    '[data-rail-section="navigation"]',
  );
  if (!(team instanceof HTMLElement) || !(plugins instanceof HTMLElement))
    throw new Error("Missing sidebar cards");
  const activity = within(team).getByRole("button", {
    name: "Activity",
  });
  expect(
    within(plugins).queryByRole("button", { name: "Activity" }),
  ).toBeNull();
  fireEvent.contextMenu(activity);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Plugins" }));
  expect(
    within(plugins).getByRole("button", { name: "Activity" }),
  ).not.toBeNull();
  expect(within(team).queryByRole("button", { name: "Activity" })).toBeNull();
});

test.each(["pins", "custom:work", "agents"])(
  "the Agents card retains an agent placed in %s without duplicating it",
  (destination) => {
    const entry: RailEntry = {
      id: "agent:owned",
      label: "Owned agent",
      kind: "agent",
      target: { kind: "person", pubkey: "a".repeat(64) },
    };
    writeView("agent-placement", "navigation-layout:v1", {
      order: [],
      sections: [{ id: "custom:work", title: "Work" }],
      placements: [{ section: destination, entry }],
    });
    const view = render(
      <RailArrangement
        partition="agent-placement"
        isPinned={() => false}
        onTogglePin={() => {}}
        openSection={() => {}}
        renderEntry={(item) => <NavigationItem label={item.label} />}
        sections={[
          {
            id: "pins",
            title: "Pins",
            content: <RailGroup id="pins" title="Pins" />,
          },
          {
            id: "agents",
            title: "Agents",
            content: (
              <RailGroup
                id="agents"
                title="Agents"
                rows={[
                  { entry, content: <NavigationItem label={entry.label} /> },
                ]}
              />
            ),
          },
        ]}
      />,
    );
    const agents = view.container.querySelector('[data-rail-section="agents"]');
    if (!(agents instanceof HTMLElement))
      throw new Error("Missing Agents card");
    expect(
      within(agents).getAllByRole("button", { name: "Owned agent" }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Owned agent" })).toHaveLength(
      destination === "agents" ? 1 : 2,
    );
  },
);
