import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { RelaySession } from "../../features/relay/session";
import { useChannelRoster } from "../../features/relay/react";
import type { Navigation } from "../../features/navigation/controller";
import type { NavigationScope } from "../../features/navigation/targets";
import type { RegisteredPage } from "../../features/pages/service";
import type { SidebarSections } from "../../features/channel-navigation/sidebar-sections-service";
import { soloDraft } from "../../features/channel-navigation/routes";
import { ListColumn } from "./ListColumn";
import {
  listsConversations,
  routedSection,
  type ListColumn as ListColumnState,
} from "./list-column";
import { RailNavigation } from "./RailNavigation";
import { useRailLayout } from "./rail-layout";
import { useRailPins, type RailEntry } from "./rail-pins";
import { railSections } from "./rail-sections";

/**
 * The list column for the current visit: which section it lists, and that
 * section's rows. Pages that list no conversations render alone.
 */
export function SectionListColumn({
  session,
  scope,
  navigator,
  pages,
  onSelect,
  sidebarSections,
  list,
  setOpen,
  children,
}: {
  session: RelaySession;
  scope: NavigationScope;
  navigator: Navigation;
  pages: readonly RegisteredPage[];
  onSelect(key: string): void;
  sidebarSections?: SidebarSections | undefined;
  list: ListColumnState;
  setOpen(open: boolean, animate?: boolean): void;
  children: ReactNode;
}) {
  const partition = `${scope.communityOrigin}:${scope.viewer}`;
  const visit = useSyncExternalStore(navigator.subscribe, navigator.snapshot);
  const target = visit.entry.target;
  const active = listsConversations(target);
  const { layout } = useRailLayout(partition);
  const { pins } = useRailPins(partition);
  const roster = useChannelRoster(session.channels);
  const contributed = useSyncExternalStore(
    sidebarSections?.subscribe ?? noSubscription,
    sidebarSections?.snapshot ?? noSections,
    sidebarSections?.snapshot ?? noSections,
  );
  const membership = useMemo(
    () =>
      railSections(
        layout,
        contributed.map((section) => ({
          id: section.key,
          title: section.title,
        })),
      ),
    [layout, contributed],
  );
  const selected =
    target.kind === "conversation"
      ? roster.channels.find((channel) => channel.id === target.channelId)
      : undefined;
  const belongs = (entry: RailEntry) => {
    if (target.kind !== "conversation") return false;
    const destination = entry.target;
    return destination.kind === "conversation"
      ? destination.channelId === target.channelId &&
          (!destination.threadRootId ||
            destination.threadRootId === target.threadRootId) &&
          (!destination.messageId || destination.messageId === target.messageId)
      : destination.kind === "person" &&
          selected?.channelType === "dm" &&
          selected.participants?.length === 1 &&
          selected.participants[0] === destination.pubkey;
  };
  const section =
    (list.section && membership.sections.has(list.section)
      ? list.section
      : undefined) ??
    membership.owner(belongs) ??
    (pins.some(belongs) ? "pins" : undefined) ??
    (selected?.channelType === "solo" ||
    (target.kind === "page" && soloDraft(target.route?.params))
      ? "solo"
      : "messages");
  const title = membership.sections.get(section) ?? "Team";
  return (
    <ListColumn
      scope={partition}
      list={active ? list : undefined}
      setOpen={setOpen}
      title={title}
      label={
        section === "messages" || section === "solo"
          ? title
          : `${title} workspace`
      }
      fill={routedSection(target) !== undefined}
      content={
        active && (
          <RailNavigation
            key={partition}
            pageSection={section}
            session={session}
            scope={scope}
            navigator={navigator}
            pages={pages}
            selected="buzz.channels/channels"
            onSelect={onSelect}
            sidebarSections={sidebarSections}
          />
        )
      }
    >
      {children}
    </ListColumn>
  );
}

const noSubscription = () => () => {};
const emptySections: readonly never[] = [];
const noSections = () => emptySections;
