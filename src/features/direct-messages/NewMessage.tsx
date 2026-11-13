import { agentUnavailable } from "../agents/choices";
import {
  creationDestinationKey,
  creationPeople as validRecipients,
  readCreationDestination,
  saveCreationDestination,
  type CreationDestination,
} from "./creation-destination";
import { SoloDraft } from "../solo/SoloDraft";
import type { ComponentProps } from "react";
import { AvatarStack } from "../../shared/design-system/ui/AvatarStack";
import { createPortal } from "react-dom";
import { canMessageAgent } from "../agents/choices";
import { useAgentChoices } from "../agents/use-choices";
import { avatarMedia } from "../../shared/avatar-source";
import type { ChannelSummary } from "../relay/contracts";
import type { ConversationHostServices } from "../conversation/ConversationHost";
import { composerMarkdown } from "../messages/composer-markdown";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { attachmentMessage } from "../relay/attachments";
import type { OutgoingEvent } from "../relay/outbox";
import type { RelaySession } from "../relay/session";
import type { ConversationExtensions } from "../conversation/contracts";
import { DraftMentionRoster } from "../messages/draft-mention-roster";
import {
  clearAttachmentDraft,
  type AttachmentDraft,
} from "../messages/attachment-draft";
import { MessageComposer } from "../messages/MessageComposer";
import {
  mentionDraft,
  type MentionDraft,
  type MentionRecipient,
} from "../messages/mention-draft";
import { clearView, readView, writeView } from "../../shared/view-state";
import { Button } from "../../shared/design-system/ui/Button";
import {
  useVerifiedNames,
  withVerifiedNames,
} from "../profiles/useVerifiedNames";
import { addressableChannels, RecipientPicker } from "./RecipientPicker";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { PlusIcon } from "../../shared/design-system/icons";
import { relativeTimestamp } from "../../shared/relative-timestamp";
import { usePeople, type Recipient } from "./usePeople";
import { usePassThroughUntilDrafted } from "../messages/draft-visit";
import type { PageNavigation } from "../navigation/service";
import styles from "./NewMessage.module.css";
import { ExistingDiscussion } from "./ExistingDiscussion";

const draftKey = "direct-message:new-draft";
const channelViewKey = "direct-message:channel";
const teamViewKey = "direct-message:team-for";
type Kind = "solo" | "team";
const recoveryKey = "direct-message:new";

type Pending = {
  id: string;
  channelId: string;
  recipients: string;
  draft: MentionDraft;
  attachments: readonly (readonly string[])[];
  channelTarget?: string | undefined;
};
const keyFor = (people: readonly Recipient[]) =>
  people
    .map((person) => person.pubkey)
    .sort()
    .join(":");
// Persist identity and a bounded label, never the directory's full metadata.
const recipientView = ({ pubkey, name, isAgent }: Recipient): Recipient => ({
  pubkey,
  name: name.slice(0, 500),
  ...(isAgent === true ? { isAgent: true } : {}),
});
// Earlier development builds wrote a separate pointer. Keep it confirmation-only;
// its absence from the journal must never authorize a replacement message.
function savedLegacy(
  scope: string,
  viewer?: string,
): (Pending & { people: Recipient[] }) | undefined {
  const value = readView<Partial<Pending> | null>(
    scope,
    "direct-message:pending",
    null,
  );
  if (
    value &&
    typeof value.id === "string" &&
    /^[0-9a-f]{64}$/.test(value.id) &&
    typeof value.channelId === "string" &&
    /^[0-9a-f-]{36}$/.test(value.channelId) &&
    typeof value.recipients === "string" &&
    value.recipients.length <= 519 &&
    value.draft
  )
    return {
      id: value.id,
      channelId: value.channelId,
      recipients: value.recipients,
      draft: mentionDraft(value.draft),
      attachments: [],
      people: validRecipients(
        readView(scope, "direct-message:recipients", []),
        viewer,
      ),
    };
}

function recovered(operations: readonly OutgoingEvent[], viewer?: string) {
  const item = operations.find((item) => item.recovery?.key === recoveryKey);
  if (!item?.recovery) return undefined;
  const value = JSON.parse(item.recovery.value);
  const people = validRecipients(value.people, viewer);
  const channelId = item.event.tags.find(([name]) => name === "h")?.[1];
  const channelTarget = value.channelTarget;
  if (
    item.event.kind !== 9 ||
    !channelId ||
    (channelTarget !== undefined && channelTarget !== channelId) ||
    (!people.length && !channelTarget)
  )
    throw new Error("The saved new message could not be restored.");
  return {
    id: item.event.id,
    channelId,
    recipients: channelTarget ? `channel:${channelTarget}` : keyFor(people),
    channelTarget,
    draft: mentionDraft(value.draft),
    attachments: item.event.tags.filter(([name]) => name === "imeta"),
    people,
  };
}

/** Recipient-first conversation that can open directly or send through the durable outbox. */
export function NewMessage({
  session,
  scope,
  extensions,
  channels,
  onPreparing,
  host,
  onOpenThread,
  onStarted,
  visit,
  allowChannels = false,
  layout = "page",
  expanded = false,
  onAddressed,
  contentContainer,
  solo,
  onOpenChat,
}: {
  /** Activity embeds the same draft and delivery owner without a second history. */
  layout?: "page" | "composer";
  expanded?: boolean;
  onAddressed?: (() => void) | undefined;
  /** Move the presentation into the host's expanded surface; this owner stays mounted. */
  contentContainer?: HTMLElement | null;
  /** To may also name a channel: Send posts a new message there. */
  allowChannels?: boolean;
  /** Solo uses the same creation draft and parent lock as Team. */
  solo?:
    | Pick<ComponentProps<typeof SoloDraft>, "onStarted" | "onFailed">
    | undefined;
  /** Continue an earlier Solo chat listed beside a chosen agent. */
  onOpenChat?: ((channelId: string) => void) | undefined;
  session: RelaySession;
  scope: string;
  /** The visit presenting this composer, a Back stop only once drafted. */
  visit?: PageNavigation | undefined;
  extensions?: ConversationExtensions | undefined;
  channels: readonly ChannelSummary[];
  host: ConversationHostServices;
  onPreparing?(pubkeys: readonly string[]): void;
  onOpenThread(
    channelId: string,
    messageId: string,
    threadRootId: string,
    intent?: "reply",
  ): void;
  onStarted(channelId: string, messageId: string): void;
}) {
  // A message held for delivery or retry stays a Back stop even when its
  // draft view is gone or it carries only attachments.
  const held = useRef(false);
  const holds = useCallback(() => held.current, []);
  const draftEdited = usePassThroughUntilDrafted(
    visit,
    session,
    scope,
    draftKey,
    { held: holds },
  );
  const [destination, setDestination] = useState(() =>
    readCreationDestination(scope, session.viewer, allowChannels),
  );
  const recipients =
    destination.kind === "people" ? destination.people : emptyRecipients;
  const channelId =
    destination.kind === "channel" ? destination.channelId : undefined;
  // A lone agent starts a Solo chat unless Team was picked for it.
  const [teamFor, setTeamFor] = useState(() => {
    const saved = readView<unknown>(scope, teamViewKey, null);
    return typeof saved === "string" ? saved : undefined;
  });
  // Recipients keep the facts they were chosen with; their labels follow the
  // current verification and otherwise the current profile name, falling back
  // to those facts.
  const verified = useVerifiedNames(session, recipients);
  const profiles = useSyncExternalStore(
    session.profiles.subscribe,
    session.profiles.snapshot,
  );
  const agents = useAgentChoices(
    session,
    layout === "composer",
    layout === "composer",
  );
  const named = useMemo(
    () =>
      withVerifiedNames(
        recipients.map((person) => {
          const current = profiles.get(person.pubkey);
          const picture =
            current?.picture ??
            person.picture ??
            agents.identities.find((agent) => agent.pubkey === person.pubkey)
              ?.avatar;
          return {
            ...person,
            ...(current && !current.verified ? { name: current.name } : {}),
            ...(picture ? { picture } : {}),
          };
        }),
        verified,
        profiles,
      ),
    [recipients, verified, profiles, agents.identities],
  );
  const recipientNames = named.map((person) => person.name).join(", ");
  const [inlineQuery, setInlineQuery] = useState<string>();
  const directory = usePeople(
    session,
    inlineQuery ?? "",
    layout === "composer" && inlineQuery !== undefined,
  );
  const inlinePeople = useMemo(() => {
    const eligible = new Set(
      agents.identities.filter(canMessageAgent).map((agent) => agent.pubkey),
    );
    return [
      ...new Map(
        [
          ...[...profiles].map(([pubkey, profile]) => ({ ...profile, pubkey })),
          ...directory.people,
          ...agents.selectable.map((agent) => ({
            ...agent,
            isAgent: true as const,
          })),
          ...named,
        ]
          .filter(
            (person) =>
              person.pubkey !== session.viewer &&
              (!person.isAgent || eligible.has(person.pubkey)),
          )
          .map((person) => [person.pubkey, person]),
      ).values(),
    ];
  }, [
    agents.identities,
    agents.selectable,
    profiles,
    directory.people,
    named,
    session.viewer,
  ]);
  const roster = useMemo(
    () =>
      layout === "composer"
        ? { recipients: inlinePeople, onQuery: setInlineQuery }
        : { recipients },
    [layout, inlinePeople, recipients],
  );
  // Text still in the To field may be a recipient not chosen yet, so Send
  // waits for it to become one or be cleared.
  const [typed, setTyped] = useState(false);
  const [legacy, setLegacy] = useState(() =>
    savedLegacy(scope, session.viewer),
  );
  const initialLegacy = useRef(legacy);
  const [ready, setReady] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<MentionDraft>();
  const [draftRevision, setDraftRevision] = useState(0);
  const [composerFocus, setComposerFocus] = useState(0);
  const focusComposer = useCallback(() => {
    setComposerFocus((request) => request + 1);
  }, []);
  const previousContainer = useRef(contentContainer);
  useLayoutEffect(() => {
    if (previousContainer.current === contentContainer) return;
    previousContainer.current = contentContainer;
    focusComposer();
  }, [contentContainer, focusComposer]);
  const retiring = useRef<string | undefined>(undefined);
  const [busy, setBusy] = useState<"uploading" | "sending" | undefined>();
  const [error, setError] = useState("");
  const [uploadFailed, setUploadFailed] = useState(false);
  const [draftChannel] = useState(() => crypto.randomUUID());
  const attempt = useRef<AbortController | null>(null);
  const prepared = useRef<{ key: string; id: string } | undefined>(undefined);
  const outbox = session.outbox;
  const operations = useSyncExternalStore(
    outbox?.subscribe ?? noSubscribe,
    outbox?.snapshot ?? emptySnapshot,
    emptySnapshot,
  );
  let pending: (Pending & { people: Recipient[] }) | undefined;
  try {
    pending = recovered(operations, session.viewer) ?? legacy;
  } catch {
    /* Readiness presents invalid recovery. */
  }
  held.current = !!pending;
  const failed =
    pending && session.directMessages.delivery(pending.id) === "failed";
  const [soloBusy, setSoloBusy] = useState(false);
  const locked = soloBusy || !ready || !!busy || (!!pending && !failed);
  const retire = useCallback(() => {
    clearAttachmentDraft(session, `${scope}:${draftKey}`);
    retiring.current = undefined;
    prepared.current = undefined;
    draftEdited(undefined);
    setDestination({ kind: "people", people: [] });
    setTeamFor(undefined);
    setRestoredDraft(mentionDraft(""));
    setDraftRevision((revision) => revision + 1);
  }, [session, scope, draftEdited]);
  useLayoutEffect(() => {
    const confirmed = pending && session.directMessages.delivery(pending.id);
    if (pending) {
      retiring.current =
        confirmed === "accepted" || confirmed === "seen"
          ? pending.id
          : undefined;
    } else if (retiring.current) {
      // A different mount may have completed acknowledgement while this page
      // restored its recovery payload. Never leave that payload as a fresh draft.
      retire();
    }
  }, [pending, session.directMessages, retire]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await outbox?.ready();
        if (!active) return;
        const saved =
          recovered(outbox?.snapshot() ?? [], session.viewer) ??
          initialLegacy.current;
        if (saved) {
          const editable =
            session.directMessages.delivery(saved.id) === "failed";
          const original: CreationDestination = saved.channelTarget
            ? { kind: "channel", channelId: saved.channelTarget }
            : { kind: "people", people: saved.people };
          setDestination(
            editable
              ? readCreationDestination(
                  scope,
                  session.viewer,
                  allowChannels,
                  original,
                )
              : original,
          );
          setRestoredDraft(
            editable
              ? mentionDraft(readView(scope, draftKey, saved.draft))
              : saved.draft,
          );
        }
        setReady(true);
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not restore the message.",
          );
      }
    })();
    return () => {
      active = false;
      attempt.current?.abort();
    };
  }, [outbox, session.viewer, session.directMessages, scope, allowChannels]);
  function validateAgents() {
    const controlled = new Set(
      session.agentChoices
        .snapshot()
        // Forward-looking: neither archived nor being deleted.
        .selectable.filter(canMessageAgent)
        .map((agent) => agent.pubkey),
    );
    if (
      recipients.some(
        (person) =>
          // By key, whatever its profile says.
          agentUnavailable(session, person.pubkey) ||
          ((person.isAgent ||
            session.profiles.snapshot().get(person.pubkey)?.isAgent) &&
            !controlled.has(person.pubkey)),
      )
    )
      throw new Error(
        "A selected agent is no longer available. Remove it or refresh its details and try again.",
      );
  }
  function change(people: Recipient[]) {
    if (locked || attempt.current) return;
    prepared.current = undefined;
    const next: CreationDestination = { kind: "people", people };
    setDestination(next);
    saveCreationDestination(scope, next);
    setError("");
    setUploadFailed(false);
  }
  function syncInlineRecipients(draft: MentionDraft) {
    if (layout !== "composer") return;
    const people = draft.recipients.map(
      (person) =>
        inlinePeople.find((candidate) => candidate.pubkey === person.pubkey) ??
        person,
    );
    if (keyFor(people) === keyFor(recipients)) return;
    change(people);
    if (people.length) onAddressed?.();
  }
  function chooseChannel(channel: ChannelSummary | undefined) {
    if (locked || attempt.current) return;
    prepared.current = undefined;
    const next: CreationDestination = channel
      ? { kind: "channel", channelId: channel.id }
      : { kind: "people", people: [] };
    setDestination(next);
    saveCreationDestination(scope, next);
    setError("");
    setUploadFailed(false);
  }
  async function send(
    draft: MentionDraft,
    files?: AttachmentDraft,
    addressed?: readonly MentionRecipient[],
    references: readonly string[] = [],
  ) {
    const posting =
      target?.id ?? (!recipients.length ? pending?.channelTarget : undefined);
    const content = composerMarkdown(draft);
    if (
      attempt.current ||
      !ready ||
      (!posting && !recipients.length) ||
      (!content.trim() && !files?.snapshot().length && !pending) ||
      (!posting && !session.directMessages.available)
    )
      return;
    const controller = new AbortController();
    attempt.current = controller;
    setBusy(
      files?.snapshot().some((file) => !file.uploaded)
        ? "uploading"
        : "sending",
    );
    setError("");
    setUploadFailed(false);
    const key = posting ? `channel:${posting}` : keyFor(recipients);
    let current: Pending | undefined = pending;
    let preparingFiles = !!files;
    try {
      // Confirmation-only retries must retain the exact durable event.
      const uploaded = files
        ? await files.prepareForSend(controller.signal)
        : [];
      controller.signal.throwIfAborted();
      preparingFiles = false;
      setBusy("sending");
      // Compare the complete published metadata; messages.send still validates
      // every upload against the actual community origin.
      const attachments = attachmentMessage(
        "",
        uploaded,
        uploaded[0]?.url,
      ).tags;
      if (
        !posting &&
        current &&
        session.directMessages.delivery(current.id) === "failed"
      )
        validateAgents();
      if (
        current &&
        (current.recipients !== key ||
          JSON.stringify(current.draft) !==
            JSON.stringify(mentionDraft(draft)) ||
          (files &&
            JSON.stringify(current.attachments) !==
              JSON.stringify(attachments)))
      ) {
        if (session.directMessages.delivery(current.id) !== "failed")
          throw new Error(
            "Retry the earlier message to confirm its delivery before editing.",
          );
        if (posting && !target)
          throw new Error(
            "This channel is no longer available for a new message.",
          );
        if (!posting) validateAgents();
        await outbox?.dismiss(current.id);
        controller.signal.throwIfAborted();
        current = undefined;
        setLegacy(undefined);
        writeView(scope, "direct-message:pending", null);
      }
      if (!current) {
        if (posting && !target)
          throw new Error(
            "This channel is no longer available for a new message.",
          );
        if (!posting) {
          validateAgents();
          onPreparing?.(recipients.map((person) => person.pubkey));
        }
        const id =
          posting ??
          (prepared.current?.key === key
            ? prepared.current.id
            : await session.directMessages.open(
                recipients.map((person) => person.pubkey),
                controller.signal,
              ));
        controller.signal.throwIfAborted();
        prepared.current = { key, id };
        if (!posting) validateAgents();
        const messageId = session.messages.send(
          id,
          content,
          (addressed ?? draft.recipients).map((person) => person.pubkey),
          uploaded,
          {
            key: recoveryKey,
            value: JSON.stringify({
              people: recipients.map(recipientView),
              draft,
              channelTarget: posting,
            }),
          },
          references,
        );
        current = {
          id: messageId,
          channelId: id,
          channelTarget: posting,
          recipients: key,
          draft,
          attachments,
        };
      }
      await session.directMessages.delivered(
        current.id,
        current.channelId,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      // Clear disposable views before releasing durable recovery. A failed clear
      // retains the operation for confirmation-only retry, even across unmount.
      clearView(
        scope,
        draftKey,
        "direct-message:pending",
        "direct-message:recipients",
        channelViewKey,
        creationDestinationKey,
        teamViewKey,
      );
      await outbox?.acknowledge(current.id);
      if (controller.signal.aborted) return;
      setLegacy(undefined);
      // The page can stay mounted (Settings open), so never leave the sent
      // message as an editable draft that could be published again.
      retire();
      onStarted(current.channelId, current.id);
    } catch (reason) {
      if (!controller.signal.aborted && preparingFiles) setUploadFailed(true);
      else if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not send your message. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(undefined);
      if (attempt.current === controller) attempt.current = null;
    }
  }
  const existing = useMemo(() => {
    if (!recipients.length) return undefined;
    const members = new Set([
      session.viewer,
      ...recipients.map((person) => person.pubkey),
    ]);
    let match: ChannelSummary | undefined;
    for (const channel of channels) {
      if (
        channel.channelType !== "dm" ||
        channel.archived ||
        channel.cached ||
        channel.readOnly ||
        channel.pending ||
        channel.huddle ||
        channel.members?.length !== members.size ||
        !channel.members.every((member) => members.has(member))
      )
        continue;
      const activity = channel.lastActivityAt ?? 0;
      const latest = match?.lastActivityAt ?? 0;
      if (
        !match ||
        activity > latest ||
        (activity === latest && channel.id.localeCompare(match.id) < 0)
      )
        match = channel;
    }
    return match;
  }, [channels, recipients, session.viewer]);
  const channelChoices = useMemo(
    () => (allowChannels ? addressableChannels(channels) : []),
    [allowChannels, channels],
  );
  const target = channelId
    ? channelChoices.find((channel) => channel.id === channelId)
    : undefined;
  const lone = recipients.length === 1 ? recipients[0] : undefined;
  const loneAgent =
    solo &&
    !target &&
    lone &&
    (lone.isAgent || profiles.get(lone.pubkey)?.isAgent)
      ? lone.pubkey
      : undefined;
  const kind: Kind | null =
    solo && ready && !pending && loneAgent && teamFor !== loneAgent
      ? "solo"
      : target || recipients.length || pending || !solo
        ? "team"
        : null;
  const soloAgent = kind === "solo" ? loneAgent : undefined;
  const agentLabel = soloAgent ? named[0]?.name : undefined;
  const recent = useMemo(
    () =>
      soloAgent
        ? channels
            .filter(
              (channel) =>
                channel.channelType === "solo" &&
                !channel.archived &&
                !channel.pending &&
                channel.members?.includes(soloAgent),
            )
            .sort(
              (left, right) =>
                (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0),
            )
            .slice(0, 3)
        : [],
    [channels, soloAgent],
  );
  const kindControl =
    solo || allowChannels ? (
      <div className={styles.kind}>
        <Tabs<Kind>
          variant="segmented"
          size="sm"
          label="Conversation"
          value={kind}
          showSelection={kind !== null}
          items={[
            {
              value: "solo",
              label: "Solo",
              disabled: locked || !solo || !loneAgent,
            },
            { value: "team", label: "Team", disabled: locked || kind === null },
          ]}
          onValueChange={(next) => {
            if (locked || !loneAgent) return;
            const choice = next === "team" ? loneAgent : undefined;
            setTeamFor(choice);
            writeView(scope, teamViewKey, choice ?? null);
          }}
        />
      </div>
    ) : undefined;
  const displayed = target ?? existing;
  const composerName = target ? `#${target.name}` : recipientNames;
  const recipientArtwork = (solo: boolean) => (
    <AvatarStack
      animateEntrance
      size="hero-large"
      max={solo ? 1 : 5}
      items={named.map((person) => ({
        id: person.pubkey,
        name: person.name,
        src: avatarMedia(person.picture, session.media),
        shape: solo || person.isAgent ? "squircle" : "circle",
      }))}
    />
  );
  const content = (
    <section
      className={styles.page}
      data-layout={layout}
      data-expanded={expanded || undefined}
      aria-label="New message"
      data-attachment-drop-zone
    >
      {layout === "page" && (
        <RecipientPicker
          session={session}
          scope={scope}
          initiallyOpen={layout === "page"}
          selected={recipients}
          labels={named}
          disabled={locked}
          onChange={change}
          onComplete={focusComposer}
          onTyped={setTyped}
          channelOptions={channelChoices}
          selectedChannel={target}
          onChooseChannel={allowChannels ? chooseChannel : undefined}
          trailing={kindControl}
        />
      )}
      {soloAgent && solo ? (
        <>
          {(layout === "page" || expanded) && (
            <div className={styles.solo} data-new-message-body="">
              {recipientArtwork(true)}
              {recent.length > 0 && (
                <nav
                  className={styles.recent}
                  aria-label={`Recent chats with ${agentLabel}`}
                >
                  <h3>Recent with {agentLabel}</h3>
                  <NavigationItem
                    selected
                    aria-current="true"
                    icon={<PlusIcon size={16} aria-hidden="true" />}
                    label="New chat"
                    onClick={focusComposer}
                  />
                  {recent.map((chat) => (
                    <NavigationItem
                      key={chat.id}
                      label={chat.name}
                      trailing={
                        chat.lastActivityAt ? (
                          <span className={styles.agent}>
                            {relativeTimestamp(chat.lastActivityAt)}
                          </span>
                        ) : undefined
                      }
                      onClick={() => onOpenChat?.(chat.id)}
                    />
                  ))}
                </nav>
              )}
            </div>
          )}
          <div className={styles.soloComposer}>
            <SoloDraft
              key={soloAgent}
              embedded
              draftPrefix="direct-message"
              session={session}
              scope={scope}
              extensions={extensions}
              agent={soloAgent}
              focusRequest={composerFocus}
              onDraftChange={
                layout === "composer" ? syncInlineRecipients : undefined
              }
              onBusyChange={setSoloBusy}
              {...solo}
            />
          </div>
        </>
      ) : (
        <>
          {(layout === "page" || expanded) && (
            <div className={styles.blank} data-new-message-body="">
              {displayed ? (
                <ExistingDiscussion
                  key={displayed.id}
                  session={session}
                  scope={scope}
                  channel={displayed}
                  extensions={extensions}
                  host={host}
                  onRecovered={focusComposer}
                  onOpen={(messageId, threadRootId, intent) =>
                    onOpenThread(displayed.id, messageId, threadRootId, intent)
                  }
                />
              ) : recipients.length > 0 ? (
                <div className={styles.introduction}>
                  {recipientArtwork(false)}
                </div>
              ) : null}
            </div>
          )}
          <div className={styles.feedback}>
            {layout === "composer" &&
              inlineQuery !== undefined &&
              directory.error && (
                <div role="alert">
                  <p>Could not search people. Your draft is kept.</p>
                  <Button type="button" onClick={directory.loadMore}>
                    Retry loading people
                  </Button>
                </div>
              )}
            {busy && (
              <p role="status">
                {busy === "uploading" ? "Uploading files…" : "Sending message…"}
              </p>
            )}
            {uploadFailed && (
              <p role="status">
                A file couldn’t upload. Retry or remove it, then send again.
              </p>
            )}
            {!target && !session.directMessages.available && (
              <p role="status">
                Starting direct messages is unavailable on this connection.
              </p>
            )}
            {pending && !failed && !busy && !error && (
              <Button
                type="button"
                onClick={() => pending && void send(pending.draft)}
              >
                Retry send
              </Button>
            )}
            {error && (
              <div role="alert">
                <p>{error}</p>
                {pending && !failed && (
                  <Button
                    type="button"
                    disabled={!!busy}
                    onClick={() => pending && void send(pending.draft)}
                  >
                    Retry send
                  </Button>
                )}
              </div>
            )}
          </div>
          <DraftMentionRoster.Provider value={target ? undefined : roster}>
            <MessageComposer
              key={`${ready ? "ready" : "hydrating"}:${draftRevision}`}
              session={session}
              scope={scope}
              extensions={extensions}
              channelId={target?.id ?? draftChannel}
              focusRequest={composerFocus}
              channelName={composerName || "new message"}
              label={composerName ? `Message ${composerName}` : "New message"}
              placeholder={
                composerName
                  ? undefined
                  : layout === "composer"
                    ? "@mention someone to start a message…"
                    : ""
              }
              disabled={layout === "page" && !recipients.length && !target}
              submission={{
                channel: target ? true : undefined,
                draftKey,
                attachments: true,
                allowAttachmentOnly: true,
                recoveredDraft: restoredDraft,
                onDraftChange: (draft) => {
                  draftEdited(draft);
                  syncInlineRecipients(draft);
                },
                locked,
                disabled:
                  !ready ||
                  !!busy ||
                  (target
                    ? false
                    : !recipients.length ||
                      !session.directMessages.available) ||
                  typed,
                submit: (
                  draft,
                  files,
                  addressed,
                  _picks,
                  _draftPicks,
                  _revision,
                  references,
                ) => void send(draft, files, addressed, references),
              }}
            />
          </DraftMentionRoster.Provider>
        </>
      )}
    </section>
  );
  return contentContainer ? createPortal(content, contentContainer) : content;
}
const empty: readonly never[] = [];
const emptySnapshot = () => empty;
const noSubscribe = () => () => {};

const emptyRecipients: Recipient[] = [];
