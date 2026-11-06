import { useEffect, useRef, useState } from "react";
import { useAgentChoices } from "../../features/agents/use-choices";
import { useSavedAgentState } from "../../features/solo/default-agent";
import {
  useChannelRoster,
  useRelayConnection,
} from "../../features/relay/react";
import { messageCopyLink } from "../../features/messages/message-copy";
import { splitPartition } from "../../features/relay/partition";
import {
  ConversationChannel,
  ConversationComposer,
} from "../../features/conversation/Conversation";
import { ConversationPresentation } from "../../features/conversation/ConversationPresentation";
import { ChannelBody } from "../channels/ChannelBody";
import { SoloColumn } from "../../features/solo/SoloPresentation";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { XIcon } from "../../shared/design-system/icons";
import { CatchUpAvatar } from "./CatchUpAvatar";
import { messagePreviewText } from "../../features/conversation/message-preview-text";
import panelStyles from "./CatchUpPanel.module.css";
import type { CatchUpOpening } from "./catch-up-context";
import styles from "./PinnedBestie.module.css";

type Request = {
  channelId: string;
  create: string;
  agent: { pubkey: string; name: string };
  messageId?: string;
};

/** The mounted exchange owns one submission, not its source row or visibility.
 * Retry reuses the create operation; remounting readers never resubmits it. */
export function CatchUpPanel({
  source,
  shown,
  hide,
  started,
}: {
  source: CatchUpOpening;
  shown: boolean;
  hide(): void;
  started(channelId: string): void;
}) {
  const connection = useRelayConnection(source.host.relay);
  const session = connection.session;
  const saved = useSavedAgentState(session, source.session.scope);
  const choices = useAgentChoices(session, true, true);
  const savedBestie = choices.selectable.find(
    (agent) => agent.pubkey === saved.agent,
  );
  const ask = source.ask;
  // An ask names its agent; a catch-up uses the saved Bestie.
  const bestie = ask
    ? {
        pubkey: ask.agent.pubkey,
        name: ask.agent.name,
        managedName: undefined as string | undefined,
      }
    : savedBestie;
  const [request, setRequest] = useState<Request>();
  const [error, setError] = useState<string>();
  const [attempt, retry] = useState(0);
  const submitted = useRef<Request | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const running = useRef(false);
  const tried = useRef(-1);
  const panel = useRef<HTMLElement>(null);
  const [sent, setSent] = useState<string>();
  const roster = useChannelRoster(session.channels);
  const channel =
    request && roster.channels.find((item) => item.id === request.channelId);
  const sourceChannel = roster.channels.find(
    (item) => item.id === source.message.channelId,
  );
  const link = ask
    ? ask.threadRootId
      ? messageCopyLink(source.message, source.session.scope)
      : `buzz://channel/${ask.channelId}`
    : messageCopyLink(source.message, source.session.scope);
  const scope = splitPartition(source.session.scope);
  const isThread =
    !!source.message.threadRootId || source.message.replyCount > 0;
  const sourceName = useRef(sourceChannel?.name ?? ask?.channelName);
  const where = `${isThread ? "a thread in " : ""}#${sourceName.current ?? "a channel"}`;
  const requestPrompt = ask
    ? `${ask.question}\n\n(Asked from ${where}, where you can’t reply: ${link})`
    : `Catch me up on this ${isThread ? "thread" : "post"}. Summarize what’s happening, decisions, blockers, and the next step.\n\n${link}`;
  if (sourceChannel?.name) sourceName.current = sourceChannel.name;
  const name =
    request?.agent.name ?? bestie?.managedName ?? bestie?.name ?? "Bestie";
  const connected =
    connection.status === "ready" && connection.scope === source.session.scope;
  const currentSession = useRef(session);
  useEffect(() => {
    if (currentSession.current === session) return;
    currentSession.current = session;
    if (!submitted.current?.messageId) retry((value) => value + 1);
  }, [session]);

  useEffect(() => {
    if (shown) panel.current?.focus({ preventScroll: true });
  }, [shown]);

  useEffect(() => {
    if (
      !connected ||
      (!ask && (!saved.read || saved.error || choices.pending)) ||
      running.current ||
      tried.current === attempt
    )
      return;
    tried.current = attempt;
    if (submitted.current?.messageId) return;
    if (!bestie) {
      setError(
        ask
          ? `${ask.agent.name} is unavailable. Try again.`
          : "Your Bestie is unavailable. Choose an agent as your Bestie, then try again.",
      );
      return;
    }
    if (!link || !session.channelWrites.available) {
      setError(
        !link
          ? "This message has no link to send."
          : "Solo chats are unavailable right now.",
      );
      return;
    }
    running.current = true;
    setError(undefined);
    void (async () => {
      try {
        let current = submitted.current;
        if (!current) {
          const channelId = crypto.randomUUID();
          const agent = {
            pubkey: bestie.pubkey,
            name: bestie.managedName ?? bestie.name,
          };
          const start = session.channelWrites.start(
            channelId,
            ask ? `From ${where}` : `Catch-up with ${agent.name}`,
            [agent.pubkey],
          );
          current = { channelId, create: start.create, agent };
          submitted.current = current;
          await start.ready;
        } else {
          await session.channelWrites.delivered(current.create);
        }
        const latest = source.host.relay.snapshot();
        if (
          !mounted.current ||
          latest.session !== session ||
          latest.scope !== source.session.scope ||
          latest.status !== "ready"
        )
          throw new Error("The connection changed. Reconnect and try again.");
        current.messageId = session.messages.send(
          current.channelId,
          requestPrompt,
          [current.agent.pubkey],
          [],
        );
        setRequest({ ...current });
        started(current.channelId);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Bestie couldn’t start a catch-up.",
        );
      } finally {
        running.current = false;
      }
    })();
  }, [
    attempt,
    connected,
    saved.read,
    saved.error,
    choices.pending,
    bestie,
    session,
    source,
    link,
    requestPrompt,
    started,
    ask,
    where,
  ]);

  const openSource = () => {
    if (!scope || !connected) return;
    void source.host.navigation.open({
      version: 1,
      kind: "conversation",
      scope,
      channelId: source.message.channelId,
      ...(ask && !isThread ? {} : { messageId: source.message.id }),
      ...(isThread
        ? { threadRootId: source.message.threadRootId ?? source.message.id }
        : {}),
    });
  };
  const feedback = (ask ? undefined : saved.error) ?? error;
  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label="Bestie catch-up"
      className={panelStyles.panel}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.currentTarget.contains(event.target as Node)
        ) {
          event.stopPropagation();
          hide();
        }
      }}
    >
      <PanelHeader
        title={
          <PanelHeaderLabel
            title={name}
            icon={
              <CatchUpAvatar session={session} pubkey={request?.agent.pubkey} />
            }
          />
        }
        actions={
          <IconButton
            size="toolbar"
            aria-label="Hide Bestie catch-up"
            title="Hide catch-up"
            onClick={hide}
            icon={<XIcon size="1rem" />}
          />
        }
      />
      <div className={`${panelStyles.source} text-body-sm`}>
        <div className={panelStyles.sourceHeading}>
          <span className={panelStyles.sourceLabel}>
            {ask
              ? "Asked from"
              : `About ${isThread ? "a thread" : "a post"} in`}{" "}
            {ask ? where : (sourceName.current ?? "the original channel")}
          </span>
          <Button
            variant="link"
            size="inline"
            onClick={openSource}
            disabled={!connected}
          >
            View {isThread ? "thread" : ask ? "channel" : "post"}
          </Button>
        </div>
        <p className={panelStyles.sourceExcerpt}>
          {messagePreviewText(source.message.content) || "Original context"}
        </p>
      </div>
      {!connected ? (
        <p className="m-0 p-4 text-body-sm text-secondary" role="status">
          Reconnecting to this catch-up…
        </p>
      ) : feedback && !request ? (
        <div className="flex items-center gap-2 p-4 text-body-sm">
          <p role="alert" className="m-0 text-danger">
            {feedback}
          </p>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => {
              saved.retry();
              session.agentChoices.refresh();
              retry((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : !request || !channel ? (
        <p className="m-0 p-4 text-body-sm text-secondary" role="status">
          {request ? "Opening catch-up…" : "Preparing your catch-up…"}
        </p>
      ) : (
        <ConversationPresentation value={shown}>
          <ConversationChannel
            session={session}
            scope={source.session.scope}
            channel={channel}
            extensions={source.extensions}
            host={source.host}
            active={shown}
          >
            <div className={`${styles.work} flex min-h-0 flex-1 flex-col`}>
              <SoloColumn>
                <ChannelBody
                  cached={!!channel.cached}
                  viewer={session.viewer}
                  marksRead={shown}
                  revealMessageId={sent}
                />
                <ConversationComposer
                  shown={shown}
                  autoFocus={false}
                  defaultMention={request.agent}
                  label={`Message ${request.agent.name}`}
                  onSend={setSent}
                />
              </SoloColumn>
            </div>
          </ConversationChannel>
        </ConversationPresentation>
      )}
    </section>
  );
}
