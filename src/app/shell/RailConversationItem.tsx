import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import type { RelaySession } from "../../features/relay/session";
import type { ChannelSummary } from "../../features/relay/contracts";
import type { ReadTarget } from "../../features/relay/read-state-model";
import { ConversationRow } from "../../features/messages/ConversationRow";
import {
  channelUnread,
  useConfirmedMute,
} from "../../bundled/channels/UnreadBadge";
import type { RailEntry } from "./rail-pins";

/** Exact destinations read their own evidence; only channel rows aggregate threads. */
export function useRailUnread(
  session: RelaySession,
  destination: RailEntry["target"],
  channel?: ChannelSummary,
) {
  const target = useMemo<ReadTarget | undefined>(() => {
    if (destination.kind !== "conversation")
      return channel ? { kind: "channel", channelId: channel.id } : undefined;
    const channelId = destination.channelId;
    return destination.threadRootId
      ? { kind: "thread", channelId, rootId: destination.threadRootId }
      : destination.messageId
        ? { kind: "message", channelId, messageId: destination.messageId }
        : { kind: "channel", channelId };
  }, [destination, channel]);
  const subscribe = useCallback(
    (listener: () => void) =>
      target ? session.unread.subscribe(target, listener) : () => {},
    [session, target],
  );
  const get = useCallback(
    () => (target ? session.unread.snapshot(target) : undefined),
    [session, target],
  );
  const snapshot = useSyncExternalStore(subscribe, get, get);
  const subscribeActivity = useCallback(
    (listener: () => void) =>
      target?.kind === "channel"
        ? session.unread.subscribeActivity(target.channelId, listener)
        : () => {},
    [session, target],
  );
  const getActivity = useCallback(
    () =>
      target?.kind === "channel"
        ? session.unread.activity(target.channelId)
        : undefined,
    [session, target],
  );
  const activity = useSyncExternalStore(
    subscribeActivity,
    getActivity,
    getActivity,
  );
  const muted = useConfirmedMute(session, target?.channelId ?? "");
  if (!snapshot) return false;
  return target?.kind === "channel"
    ? channelUnread(snapshot, channel?.channelType === "dm", muted) ||
        !!activity?.items?.some((item) => item.unreadCount > 0)
    : snapshot.manual !== "none" || (snapshot.observedCount ?? 0) > 0;
}

export function RailConversationItem({
  session,
  channel,
  destination,
  avatarOnly = false,
  ...props
}: {
  session: RelaySession;
  channel: ChannelSummary;
  destination: RailEntry["target"];
  avatarOnly?: boolean;
} & Omit<
  ComponentProps<typeof ConversationRow>,
  "layout" | "state" | "time" | "preview"
>) {
  const unread = useRailUnread(session, destination, channel);
  return (
    <ConversationRow
      {...props}
      layout={avatarOnly ? "avatar" : "navigation"}
      time={null}
      preview={null}
      state={unread ? "unread" : "read"}
      aria-description={unread ? "Unread messages" : undefined}
    />
  );
}
