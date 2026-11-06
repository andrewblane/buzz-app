import { createContext, useContext } from "react";
import type { ChannelMessage } from "../../features/relay/contracts";
import type { RelaySession } from "../../features/relay/session";
import type { ConversationHostServices } from "../../features/conversation/ConversationHost";
import type { ConversationExtensions } from "../../features/conversation/contracts";

/** A question the composer hands off instead of posting it where the agent
 * cannot reply (Viewing only, or not in the channel). */
export type CatchUpAsk = {
  agent: { pubkey: string; name: string };
  question: string;
  channelId: string;
  channelName?: string | undefined;
  threadRootId?: string | undefined;
};
export type CatchUpSource = {
  session: RelaySession;
  message: ChannelMessage;
  host: ConversationHostServices;
  extensions: ConversationExtensions;
  ask?: CatchUpAsk | undefined;
};
export type CatchUpOpening = CatchUpSource & { id: string };
export const CatchUpContext = createContext<
  | {
      source: CatchUpOpening | undefined;
      visible: boolean;
      open(source: CatchUpSource): void;
      /** Starts a new Solo exchange with `ask.agent`; false when unavailable. */
      ask(session: RelaySession, ask: CatchUpAsk): boolean;
      hide(restoreFocus?: boolean): void;
    }
  | undefined
>(undefined);

/** Presentation intent only. Membership, delivery and data stay session-owned. */
export const useCatchUp = () => useContext(CatchUpContext);

// Prototype seam: the Bestie plugin registers the conversation host once, so a
// composer (which has no plugin context) can open an exchange.
let registered:
  | { host: ConversationHostServices; extensions: ConversationExtensions }
  | undefined;
export function registerCatchUpHost(
  host: ConversationHostServices,
  extensions: ConversationExtensions,
) {
  registered = { host, extensions };
  return () => {
    if (registered?.host === host) registered = undefined;
  };
}
export const catchUpHost = () => registered;

/** The exchange's source row for an ask: the thread root when there is one,
 * otherwise a stand-in for the channel itself carrying the question. */
export function askMessage(session: RelaySession, ask: CatchUpAsk) {
  return {
    id: ask.threadRootId ?? ask.channelId,
    channelId: ask.channelId,
    ...(ask.threadRootId ? { threadRootId: ask.threadRootId } : {}),
    authorId: session.viewer,
    createdAt: Math.floor(Date.now() / 1000),
    content: ask.question,
    replyCount: 0,
  } as unknown as ChannelMessage;
}
