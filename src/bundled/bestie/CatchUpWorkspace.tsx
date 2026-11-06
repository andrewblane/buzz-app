import {
  useCallback,
  isValidElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import { splitPartition } from "../../features/relay/partition";
import type { RegisteredPage } from "../../features/pages/service";
import {
  askMessage,
  catchUpHost,
  CatchUpContext,
  type CatchUpAsk,
  type CatchUpOpening,
  type CatchUpSource,
} from "./catch-up-context";
import { CatchUpPanel } from "./CatchUpPanel";
import { PanelFrame } from "../../features/panels/PanelFrame";
import { Panel } from "../../shared/design-system/ui/Panel";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { CatchUpAvatar } from "./CatchUpAvatar";
import type { RelaySession } from "../../features/relay/session";
import { useUnreadState } from "../channels/UnreadBadge";
import { createContext } from "react";
import { useBestieTake } from "./BestieExperiment";

const WorkspaceContext = createContext<
  | {
      source: CatchUpOpening | undefined;
      visible: boolean;
      hide(restoreFocus?: boolean): void;
      toggle(trigger: HTMLElement): void;
      channelId: string | undefined;
      started(channelId: string): void;
    }
  | undefined
>(undefined);

/** One in-memory exchange for this shell, fenced to its community/account.
 * The conversation stays mounted while hidden; routing never owns its lifetime. */
export function CatchUpProvider({
  pages,
  relay,
  children,
}: {
  pages: readonly RegisteredPage[];
  relay: RelayData;
  children: ReactNode;
}) {
  const take = useBestieTake();
  const connection = useRelayConnection(relay);
  const enabled = pages.some((page) => page.key === "buzz.bestie/bestie");
  const [source, setSource] = useState<CatchUpOpening>();
  const [visible, setVisible] = useState(false);
  const [channelId, setChannelId] = useState<string>();
  const trigger = useRef<HTMLElement | null>(null);
  const activeSource = useRef<CatchUpOpening | undefined>(undefined);
  // An unknown scope during reconnect is not a different account/community.
  const valid =
    enabled &&
    (!connection.scope || source?.session.scope === connection.scope);
  const current = valid ? source : undefined;
  useEffect(() => {
    if (source && !valid) {
      activeSource.current = undefined;
      setSource(undefined);
      setVisible(false);
    }
  }, [source, valid]);
  // A sent ask, once its panel closes, is let go: its Solo chat stays under
  // Solo in the sidebar, and nothing in the top bar reopens it. An ask hidden
  // before its question is sent stays held so the question still goes out.
  useEffect(() => {
    if (!source?.ask || visible || !channelId) return;
    activeSource.current = undefined;
    setSource(undefined);
    setChannelId(undefined);
  }, [source, visible, channelId]);
  const latest = useRef({ connection, enabled });
  useLayoutEffect(() => {
    latest.current = { connection, enabled };
  });
  const open = useCallback((next: CatchUpSource) => {
    const { connection, enabled } = latest.current;
    if (
      !enabled ||
      connection.status !== "ready" ||
      connection.session !== next.session
    )
      return;
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previous = activeSource.current;
    // Each ask is its own exchange; only catch-ups reopen the same source.
    const opening =
      !next.ask &&
      !previous?.ask &&
      previous?.session.scope === next.session.scope &&
      previous.message.channelId === next.message.channelId &&
      (previous.message.threadRootId ?? previous.message.id) ===
        (next.message.threadRootId ?? next.message.id)
        ? previous
        : { ...next, id: crypto.randomUUID() };
    activeSource.current = opening;
    if (opening !== previous) setChannelId(undefined);
    setSource(opening);
    const scope = splitPartition(next.session.scope);
    if (
      scope &&
      !next.ask &&
      (next.message.threadRootId || next.message.replyCount > 0)
    )
      void next.host.navigation.open({
        version: 1,
        kind: "conversation",
        scope,
        channelId: next.message.channelId,
        messageId: next.message.id,
        threadRootId: next.message.threadRootId ?? next.message.id,
      });
    setVisible(true);
  }, []);
  const hide = useCallback((restoreFocus = true) => {
    setVisible(false);
    if (!restoreFocus) return;
    const previous = trigger.current;
    const target =
      previous?.isConnected &&
      !previous.closest('[hidden], [inert], [aria-hidden="true"]')
        ? previous
        : document.querySelector<HTMLElement>("[data-catch-up-launcher]");
    target?.focus({ preventScroll: true });
  }, []);
  const ask = useCallback(
    (session: RelaySession, input: CatchUpAsk) => {
      const registered = catchUpHost();
      const { connection, enabled } = latest.current;
      if (
        !registered ||
        !enabled ||
        connection.status !== "ready" ||
        connection.session !== session
      )
        return false;
      open({
        session,
        message: askMessage(session, input),
        ask: input,
        ...registered,
      });
      return true;
    },
    [open],
  );
  const value = useMemo(
    () => ({
      source: current,
      // An ask shows in every prototype placement; catch-ups keep Current panel.
      visible: (take === "current" || !!current?.ask) && !!current && visible,
      open,
      ask,
      hide,
    }),
    [current, visible, open, ask, hide, take],
  );
  return (
    <CatchUpContext value={value}>
      <WorkspaceContext
        value={{
          source: current,
          visible: value.visible,
          hide,
          toggle: (element) => {
            trigger.current = element;
            setVisible((shown) => !shown);
          },
          channelId,
          started: setChannelId,
        }}
      >
        {children}
      </WorkspaceContext>
    </CatchUpContext>
  );
}

export function CatchUpLauncher() {
  const take = useBestieTake();
  const workspace = useContext(WorkspaceContext);
  if (take !== "current" || !workspace?.source) return null;
  return workspace.channelId ? (
    <CatchUpUnreadLauncher
      workspace={workspace}
      channelId={workspace.channelId}
      relay={workspace.source.host.relay}
    />
  ) : (
    <CatchUpToggle workspace={workspace} session={workspace.source.session} />
  );
}
function CatchUpUnreadLauncher({
  workspace,
  channelId,
  relay,
}: {
  workspace: NonNullable<React.ContextType<typeof WorkspaceContext>>;
  channelId: string;
  relay: RelayData;
}) {
  const { session } = useRelayConnection(relay);
  const { ordinary } = useUnreadState(session, channelId, true);
  return (
    <CatchUpToggle workspace={workspace} unread={ordinary} session={session} />
  );
}
function CatchUpToggle({
  workspace,
  unread = false,
  session,
}: {
  workspace: NonNullable<React.ContextType<typeof WorkspaceContext>>;
  unread?: boolean;
  session: RelaySession;
}) {
  // An ask's launcher names and shows the agent it opens, not the Bestie.
  const agent = workspace.source?.ask?.agent;
  const what = agent ? `Solo chat with ${agent.name}` : "Bestie catch-up";
  const label = workspace.visible
    ? `Hide ${what}`
    : unread
      ? `Show ${what} — unread response`
      : `Show ${what}`;
  return (
    <IconButton
      variant="chrome"
      aria-label={label}
      title={label}
      aria-expanded={workspace.visible}
      data-catch-up-launcher=""
      onClick={(event) => workspace.toggle(event.currentTarget)}
      icon={<CatchUpAvatar session={session} pubkey={agent?.pubkey} />}
    />
  );
}

/** Reuses the shell's single companion split, including narrow presentation. */
export function CatchUpFrame({
  scope,
  companion,
  children,
}: {
  scope?: string | undefined;
  companion?: ReactNode;
  children: ReactNode;
}) {
  const workspace = useContext(WorkspaceContext);
  const source = workspace?.source;
  const companionKey = isValidElement(companion) ? companion.key : companion;
  const previousCompanion = useRef(companionKey);
  useEffect(() => {
    if (
      companion &&
      previousCompanion.current !== companionKey &&
      workspace?.visible
    )
      workspace.hide(false);
    previousCompanion.current = companionKey;
  }, [companionKey, companion, workspace]);
  return (
    <PanelFrame
      scope={scope}
      companionOpen={!!companion || !!workspace?.visible}
      retainCompanion={!!source}
      companion={
        source ? (
          <>
            <div
              hidden={!workspace.visible}
              inert={!workspace.visible}
              className="h-full min-h-0 min-w-0"
            >
              <Panel as="div" joined>
                <CatchUpPanel
                  key={source.id}
                  source={source}
                  shown={workspace.visible}
                  hide={workspace.hide}
                  started={workspace.started}
                />
              </Panel>
            </div>
            {!workspace.visible && companion}
          </>
        ) : (
          companion
        )
      }
    >
      {children}
    </PanelFrame>
  );
}
