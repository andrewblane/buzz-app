import { memo, type RefCallback, type RefObject } from "react";
import type { ChannelSummary, Profile } from "../../features/relay/contracts";
import type { InboxItem } from "../../features/relay/inbox";
import type { InboxReaction } from "../../features/relay/inbox-reactions";
import type { InboxFeedSnapshot } from "../../features/relay/inbox-feed";
import type { RelaySession } from "../../features/relay/session";
import type { useIdentityNames } from "../../features/identity-names/react";
import { ChannelActivityRow } from "../../features/conversation/ConversationList";
import type { LatestMessage } from "../../features/conversation/latest-previews";
import { formatPublicKey } from "../../shared/identity/public-key";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { CheckIcon } from "../../shared/design-system/icons";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  MenuItem,
  MenuPopup,
} from "../../shared/design-system/ui/Menu";
import {
  hasUnread,
  InboxRowButton,
  ReactionRowButton,
  rowIdentity,
} from "./InboxRow";
import styles from "./Inbox.module.css";
import feedStyles from "../../features/conversation/FeedList.module.css";

export type ActivityRowActions = {
  open(item: InboxItem, channel: ChannelSummary | undefined): void;
  reaction(item: InboxReaction, channel: ChannelSummary | undefined): void;
  channel(channelId: string): void;
  menu(id?: string, anchor?: HTMLElement): void;
  read(item: InboxItem): void;
  unread(item: InboxItem): void;
};
type Common = {
  session: RelaySession;
  profiles: ReadonlyMap<string, Profile>;
  name: ReturnType<typeof useIdentityNames>;
  actions: RefObject<ActivityRowActions | null>;
  selected: boolean;
  channel: ChannelSummary | undefined;
};

/** Feed updates change data; selecting/opening a sheet need only repaint the
 * affected rows. Shared row controls and their interaction ownership stay intact. */
export const ActivityMessageRow = memo(function ActivityMessageRow({
  item,
  time,
  channel,
  session,
  profiles,
  name,
  actions,
  selected,
  feed,
  previewId,
  pending,
  canRead,
  menuOpen,
  menuUnread,
  menuAnchor,
}: Common & {
  item: InboxItem;
  time: string;
  feed: InboxFeedSnapshot;
  previewId: string;
  pending: boolean;
  canRead: boolean;
  menuOpen: boolean;
  menuUnread: boolean;
  menuAnchor: HTMLElement | undefined;
}) {
  const identity = rowIdentity(item, channel, profiles, name);
  const { sender, context } = identity;
  const unread = hasUnread(item);
  const readable = unread && canRead;
  return (
    <li
      data-inbox-row={item.id}
      className={feedStyles.item}
      data-unread={unread || undefined}
      data-action={readable || undefined}
      data-selected={selected || undefined}
    >
      <ContextMenuRoot
        open={menuOpen}
        onOpenChange={(open) =>
          actions.current?.menu(open ? item.id : undefined)
        }
      >
        <ContextMenuTrigger
          render={<div className={styles.rowSurface} />}
          onKeyDown={(event) => {
            if (
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            ) {
              event.preventDefault();
              actions.current?.menu(item.id, event.target as HTMLElement);
            }
          }}
        >
          <InboxRowButton
            item={item}
            identity={identity}
            media={session.media}
            feed={feed}
            time={time}
            previewId={previewId}
            disabled={pending}
            selected={selected}
            onPointerEnter={() => session.channels.prepare?.(item.channelId)}
            onFocus={() => session.channels.prepare?.(item.channelId)}
            onClick={() => actions.current?.open(item, channel)}
          />
          {readable && (
            <span className={styles.rowAction}>
              <IconButton
                size="xs"
                variant="ghost"
                disabled={pending}
                aria-label={`Mark as read ${sender} in ${context}`}
                title="Mark as read"
                onClick={() => actions.current?.read(item)}
                icon={<CheckIcon size={16} aria-hidden="true" />}
              />
            </span>
          )}
        </ContextMenuTrigger>
        <MenuPopup
          size="compact"
          aria-label={`Actions for ${sender} in ${context}`}
          anchor={menuAnchor}
        >
          <MenuItem
            disabled={pending || !canRead || menuUnread !== unread}
            onClick={() =>
              menuUnread
                ? actions.current?.read(item)
                : actions.current?.unread(item)
            }
          >
            {menuUnread ? "Mark as read" : "Mark unread"}
          </MenuItem>
        </MenuPopup>
      </ContextMenuRoot>
    </li>
  );
});

export const ActivityReactionRow = memo(function ActivityReactionRow({
  item,
  time,
  channel,
  session,
  profiles,
  name,
  actions,
  selected,
}: Common & { item: InboxReaction; time: string }) {
  return (
    <li
      className={feedStyles.item}
      data-inbox-row={item.id}
      onPointerEnter={() => session.channels.prepare?.(item.channelId)}
      onFocus={() => session.channels.prepare?.(item.channelId)}
    >
      <ReactionRowButton
        item={item}
        time={time}
        session={session}
        profiles={profiles}
        name={name}
        channel={channel}
        selected={selected}
        onClick={() => actions.current?.reaction(item, channel)}
      />
    </li>
  );
});

export const ActivityChannelRow = memo(function ActivityChannelRow({
  previewRef,
  channel,
  session,
  profiles,
  name,
  actions,
  selected,
  at,
  latest,
  unreadOnly,
}: Omit<Common, "channel"> & {
  previewRef: RefCallback<HTMLLIElement>;
  channel: ChannelSummary;
  at: number;
  latest: LatestMessage | undefined;
  unreadOnly: boolean;
}) {
  return (
    <ChannelActivityRow
      previewRef={previewRef}
      layout="feed"
      session={session}
      channel={channel}
      at={at}
      latest={latest}
      team
      working={false}
      profiles={profiles}
      nameOf={(id) =>
        name(id, profiles.get(id)?.name ?? formatPublicKey(id) ?? "Someone")
      }
      resolveName={name}
      unreadOnly={unreadOnly}
      selected={selected}
      onOpen={(channelId) => actions.current?.channel(channelId)}
    />
  );
});
