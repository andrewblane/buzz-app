// Local-only diagnostic: ephemeral signed relay evidence, no account or live agent.
// Match the host entry: establish layer order before product component imports.
import "../../src/shared/styles/globals.css";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Context } from "@deepseek-ai/cordis";
import { createRelaySession } from "../../src/features/relay/session";
import {
  keypair,
  signed,
  metadata,
  roster,
  message,
  bounds,
  summary,
  profile,
} from "../../src/features/relay/testing";
import type { RelayEvent } from "../../src/features/relay/events";
import type { LiveCallbacks } from "../../src/features/relay/live";
import { agentAvatars } from "../../src/features/agents/avatar-packs";
import { matchesEvent } from "../../src/features/relay/projection";
import { threadBinding } from "../../src/features/relay/thread-window";
import { useKeyboardFocusVisibility } from "../../src/shared/design-system/useKeyboardFocusVisibility";
import { localAgentsFixture } from "../../src/features/agents/local-testing";
import { setDefaultAgent } from "../../src/features/solo/default-agent";
import { PagesService } from "../../src/features/pages/service";
import { PanelsService } from "../../src/features/panels/service";
import { ConversationService } from "../../src/features/conversation/service";
import {
  provideNavigation,
  type PageNavigation,
} from "../../src/features/navigation/service";
import { AskBestie, AskBestieMenu } from "../../src/bundled/bestie/AskBestie";
import { ChannelsPage } from "../../src/bundled/channels/ChannelsPage";
import { ToastProvider } from "../../src/shared/design-system/ui/Toast";
import { AppShell } from "../../src/app/shell/AppShell";
import { PrimarySidebar } from "../../src/app/shell/PrimarySidebar";
import { ChannelNavigationProvider } from "../../src/features/channel-navigation/ChannelNavigationState";
import { createCommunities } from "../../src/features/communities/service";
import { AccountActionsService } from "../../src/features/account-actions/service";
import { createAppearance } from "../../src/shared/theme/service";
import { Button } from "../../src/shared/design-system/ui/Button";
import { registerCatchUpHost } from "../../src/bundled/bestie/catch-up-context";
import * as mentions from "../../src/bundled/mentions";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "nostr-tools/utils";

const take = new URLSearchParams(location.search).get("take") ?? "current";
// `guest`: Launch is private and Pollen, the viewer's own agent, is a Guest
// (Viewing only) there, so a mention offers "Ask in a Solo chat".
const guest = new URLSearchParams(location.search).has("guest");
// `guest=outside`: the same, but Pollen isn't in Launch at all.
const outside = new URLSearchParams(location.search).get("guest") === "outside";
// `guest=cold`: the app starts from Launch's saved membership, as on launch,
// and the relay answers for Launch's roster only after "Confirm membership".
const cold = new URLSearchParams(location.search).get("guest") === "cold";
let confirmMembership = () => {};
const confirmed = cold
  ? new Promise<void>((resolve) => {
      confirmMembership = resolve;
    })
  : undefined;
sessionStorage.setItem("buzz.dev.bestie-take", take);

const viewer = keypair(),
  authority = keypair(),
  bestie = keypair();
const origin = "https://catch-up-fixture.example";
const alpha = crypto.randomUUID(),
  beta = crypto.randomUUID(),
  dm = crypto.randomUUID();
const rootMessage = message(
  viewer,
  alpha,
  new URLSearchParams(location.search).has("longSource")
    ? "@Morgan Martin @Clay Delk @arjun PTAL at the experience and let me know what you think. " +
        "This is a long thread with a very detailed opening message and several decisions to catch up on. ".repeat(
          8,
        )
    : "Should we launch on Thursday?",
  1_700_000_000,
);
const reply = message(
  viewer,
  alpha,
  "Thursday works if the final review is complete. Morgan owns the checklist.",
  1_700_000_001,
  [["e", rootMessage.id, "", "reply"]],
);
const ownerSignature = bytesToHex(
  schnorr.sign(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`nostr:agent-auth:${bestie.pubkey}:`),
      ),
    ),
    viewer.secret,
  ),
);
const events: RelayEvent[] = [
  metadata(authority, dm, "Pollen DM", undefined, [["t", "dm"]]),
  roster(authority, dm, [viewer.pubkey, bestie.pubkey]),
  ...(guest
    ? [
        metadata(authority, alpha, "launch", undefined, [
          ["private"],
          ["t", "stream"],
        ]),
        signed(authority, {
          kind: 39001,
          content: "",
          created_at: 1_700_000_000,
          tags: [
            ["d", alpha],
            ["p", viewer.pubkey, "owner"],
          ],
        }),
        signed(authority, {
          kind: 39002,
          content: "",
          created_at: 1_700_000_000,
          tags: [
            ["d", alpha],
            ["p", viewer.pubkey, "", "owner"],
            ...(outside ? [] : [["p", bestie.pubkey, "", "guest"]]),
          ],
        }),
      ]
    : [
        metadata(authority, alpha, "Launch", undefined, [["t", "stream"]]),
        roster(authority, alpha, [viewer.pubkey]),
      ]),
  metadata(authority, beta, "Design", undefined, [["t", "stream"]]),
  roster(authority, beta, [viewer.pubkey]),
  rootMessage,
  reply,
  summary(authority, alpha, rootMessage.id, {
    reply_count: 1,
    participants: [viewer.pubkey],
  }),
  message(
    viewer,
    beta,
    "A different channel to browse while Bestie works.",
    1_700_000_002,
  ),
  profile(viewer, { name: "You" }),
  guest
    ? signed(bestie, {
        kind: 0,
        content: JSON.stringify({ name: "Pollen", bot: true }),
        created_at: 1_700_000_000,
        tags: [["auth", viewer.pubkey, "", ownerSignature]],
      })
    : profile(bestie, { name: "Pollen", bot: true }),
];
const local = localAgentsFixture([
  {
    pubkey: bestie.pubkey,
    name: "Pollen",
    relayUrl: origin,
    owner: viewer.pubkey,
    picture: agentAvatars[1]?.url ?? "",
  },
]);
const launchSaved = events.filter(
  (event) =>
    event.kind >= 39000 &&
    event.kind <= 39002 &&
    event.tags.some(([tag, value]) => tag === "d" && value === alpha),
);
let live: LiveCallbacks | undefined;
let liveChannels: readonly string[] = [];
const owner = createRelaySession(
  {
    viewer: viewer.pubkey,
    relayAuthor: authority.pubkey,
    scope: origin,
    channelIdentity: true,
    media: () => undefined,
    subscribe(callbacks) {
      live = callbacks;
      return {
        update(ids) {
          liveChannels = ids;
        },
        retry() {},
        dispose() {},
      };
    },
    query: async (filters) => {
      if (
        confirmed &&
        launchSaved.some((event) =>
          filters.some((filter) => matchesEvent(event, filter)),
        )
      )
        await confirmed;
      const found = events.filter((event) =>
        filters.some(
          (filter) =>
            matchesEvent(event, filter) ||
            // The guest walk's directory search: name prefix, like the relay.
            (guest &&
              filter.search !== undefined &&
              event.kind === 0 &&
              matchesEvent(event, {
                ...filter,
                search: undefined,
                search_mode: undefined,
              }) &&
              String(JSON.parse(event.content).name ?? "")
                .toLowerCase()
                .startsWith(filter.search.toLowerCase())) ||
            (filter.include_summaries &&
              event.kind === 39005 &&
              event.tags.some(
                ([key, value]) =>
                  key === "h" && filter["#h"]?.includes(value ?? ""),
              )),
        ),
      );
      for (const filter of filters) {
        if (filter.thread_window) {
          found.push(
            signed(authority, {
              kind: 39007,
              content: JSON.stringify({
                version: 1,
                direction: "older",
                has_more: false,
                next_cursor: null,
              }),
              tags: [
                ["h", filter["#h"]?.[0] ?? ""],
                ["e", filter["#e"]?.[0] ?? ""],
                ["d", await threadBinding(filter, origin, viewer.pubkey)],
              ],
            }),
          );
        } else
          for (const id of filter["#h"] ?? [])
            if (filter.kinds?.includes(9))
              found.push(
                bounds(authority, id, "head", {
                  has_more: false,
                  next_cursor: null,
                }),
              );
      }
      return found;
    },
    writer: {
      kinds: [9, 9007],
      sign: async (event) => signed(viewer, event),
      publish: async (event) => {
        if (event.kind === 9007) {
          const id = event.tags.find(([tag]) => tag === "h")?.[1] ?? "";
          events.push(
            metadata(
              authority,
              id,
              (guest && event.tags.find(([tag]) => tag === "name")?.[1]) ||
                "Catch-up",
              undefined,
              [["private"], ["t", "stream"], ["t", "buzz.solo"]],
            ),
            roster(authority, id, [viewer.pubkey, bestie.pubkey]),
          );
        }
        events.push(event);
      },
    },
  },
  {
    agentChoices: local,
    outboxStorage: { load: () => [], save() {} },
    ...(cold
      ? {
          prepared: true,
          persistence: {
            readStartup: async () => ({
              discovery: {
                savedAt: Date.now(),
                relayAuthor: authority.pubkey,
                events: launchSaved,
              },
            }),
            read: async () => [],
            write: async () => {},
            remove: async () => {},
            retain: async () => {},
            clear: async () => {},
            close() {},
          },
        }
      : {}),
  },
);
if (cold) await owner.restore();
live?.state({ status: "connected", routes: [] });
setDefaultAgent(owner.session.scope, bestie.pubkey);
const snapshot = {
  status: "ready" as const,
  generation: 1,
  session: owner.session,
  scope: owner.session.scope,
  viewer: viewer.pubkey,
};
const relay = {
  snapshot: () => snapshot,
  subscribe: () => () => {},
  retry() {},
  disconnect() {},
  clearCache: async () => {},
};
const ctx = new Context();
ctx.provide("pluginStatus", {
  isActive: () => true,
  subscribe: () => () => {},
});
const panels = new PanelsService(ctx),
  pages = new PagesService(ctx),
  conversation = new ConversationService(ctx);
const navigation = provideNavigation(ctx);
ctx.provide("relay", relay);
// Production message actions receive Cordis services through their plugin context,
// not an enumerable plain object. Keep that boundary in this fixture too.
const host = ctx;
await ctx
  .extend({ pluginOwner: { id: "buzz.bestie", revision: "fixture" } })
  .plugin((plugin) => {
    // Production Bestie registers this seam in its apply (bestie/index.tsx).
    plugin.effect(() => registerCatchUpHost(host, conversation));
    plugin.conversation.registerMessageAction({
      id: "catch-up",
      title: "Catch me up",
      matches: () => true,
      menu: AskBestieMenu,
      component: (props) => (
        <AskBestie {...props} host={host} extensions={conversation} />
      ),
    });
    plugin.pages.register({
      id: "bestie",
      title: "Bestie",
      component: () => null,
      primary: true,
      placement: "sidebar",
    });
    plugin.pages.register({
      id: "channels",
      title: "Messages",
      primary: true,
      placement: "topbar",
      component: () => null,
    });
  })
  .await();
// The guest walk needs the real mention chooser (a host-owned feature).
if (guest)
  await ctx
    .extend({ pluginOwner: { id: "buzz.mentions", revision: "fixture" } })
    .plugin(mentions)
    .await();
const shellPages = pages.snapshot().map((page) => ({
  ...page,
  key: page.id === "bestie" ? "buzz.bestie/bestie" : "buzz.channels/channels",
}));
const localCommunities = createCommunities(new Context(), false);
const client = {
  ...localCommunities.snapshot(),
  status: "ready" as const,
  relayAvailable: true,
  viewer: viewer.pubkey,
  profile: { name: "You", picture: "" },
  selected: origin,
  memberships: [{ id: origin, name: "Fixture community" }],
};
const communities = { ...localCommunities, relay, snapshot: () => client };
const accountActions = new AccountActionsService(ctx);
const appearance = createAppearance();
function Fixture() {
  useKeyboardFocusVisibility();
  const state = useSyncExternalStore(
    navigation.navigation.subscribe,
    navigation.navigation.snapshot,
  );
  const [request, setRequest] = useState<PageNavigation>();
  useLayoutEffect(() => {
    const next = navigation.request(state.attempt, {
      valid: () => true,
      subscribe: () => () => {},
    });
    setRequest(next.request);
    return next.dispose;
  }, [state.attempt]);
  const open = (channelId: string) =>
    void navigation.navigation.open({
      version: 1,
      kind: "conversation",
      scope: { communityOrigin: origin, viewer: viewer.pubkey },
      channelId,
    });
  const respond = () => {
    const request = [...events]
      .reverse()
      .find(
        (event) =>
          event.kind === 9 &&
          event.pubkey === viewer.pubkey &&
          (event.content.includes("Source:") ||
            event.content.includes("(Asked from") ||
            event.content.startsWith("Catch me up")),
      );
    const id = request?.tags.find(([tag]) => tag === "h")?.[1];
    if (!id || !request) return;
    if (!liveChannels.includes(id))
      throw new Error("Catch-up has no live demand");
    const answer = message(
      bestie,
      id,
      request.content.includes("(Asked from")
        ? "Thursday still works. Morgan owns the launch checklist, and the final review is the one open item.\n\nI can’t post in #launch, so I’m answering here."
        : "## You’re caught up\n\n- **Decision:** aim for Thursday.\n- **Blocker:** final review is still required.\n- **Next step:** check Morgan’s launch checklist.\n\nWant me to dig into the remaining review?",
      request.created_at + 1,
    );
    events.push(answer);
    live?.receive([answer], { phase: "live", channelId: id });
  };
  return (
    <ToastProvider>
      <ChannelNavigationProvider relay={relay}>
        <AppShell
          pages={shellPages}
          selected="buzz.channels/channels"
          navigationAttempt={state.attempt.id}
          onSelect={() => {}}
          tone="default"
          workspace
          communities={communities}
          accountActions={accountActions}
          appearance={appearance}
          onOpenTarget={(target) => {
            void navigation.navigation.open(target);
          }}
          sidebar={(children) => (
            <PrimarySidebar
              relay={relay}
              navigator={navigation.navigation}
              target={state.attempt.entry.target}
            >
              {children}
            </PrimarySidebar>
          )}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-standard p-2">
              <span className="text-caption text-secondary">
                Local fixture · synthetic conversation
              </span>
              <Button size="xs" onClick={() => open(alpha)}>
                Launch channel
              </Button>
              <Button size="xs" onClick={() => open(beta)}>
                Design channel
              </Button>
              <Button size="xs" onClick={respond}>
                Deliver fixture response
              </Button>
              {cold && (
                <Button size="xs" onClick={confirmMembership}>
                  Confirm membership
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <ChannelsPage
                relay={relay}
                panels={panels}
                pages={pages}
                navigator={navigation.navigation}
                navigation={request}
                extensions={conversation}
              />
            </div>
          </div>
        </AppShell>
      </ChannelNavigationProvider>
    </ToastProvider>
  );
}
const element = document.getElementById("root");
if (element) createRoot(element).render(<Fixture />);
