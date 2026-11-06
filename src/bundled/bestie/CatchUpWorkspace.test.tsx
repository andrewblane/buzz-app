// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode, useState } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createRelaySession } from "../../features/relay/session";
import type { RelayData, RelaySnapshot } from "../../features/relay/service";
import {
  keypair,
  signed,
  metadata,
  roster,
  message,
  bounds,
} from "../../features/relay/testing";
import { PublishRejected } from "../../features/relay/outbox";
import type { RelayEvent } from "../../features/relay/events";
import { matchesEvent } from "../../features/relay/projection";
import { foldMessages } from "../../features/relay/fold";
import { localAgentsFixture } from "../../features/agents/local-testing";
import { setDefaultAgent } from "../../features/solo/default-agent";
import { composerDOMFixture } from "../../features/messages/composer-testing";
import type { RegisteredPage } from "../../features/pages/service";
import type { ConversationHostServices } from "../../features/conversation/ConversationHost";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import {
  CatchUpProvider,
  CatchUpFrame,
  CatchUpLauncher,
} from "./CatchUpWorkspace";
import { registerCatchUpHost, useCatchUp } from "./catch-up-context";
import {
  BestieExperiment,
  BestieTakePicker,
  type BestieTake,
} from "./BestieExperiment";
import { BestieAsksProvider } from "./BestieAsks";
import { BestieHome } from "./BestieHome";
import { AskBestie } from "./AskBestie";

composerDOMFixture();
const dispose: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const stop of dispose.splice(0)) stop();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(
  take?: BestieTake,
  refuseFirstCreate = false,
  { asked }: { asked?: string } = {},
) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const viewer = keypair(),
    authority = keypair(),
    agent = keypair(),
    other = keypair();
  const channelId = crypto.randomUUID();
  const origin = "https://catch-up.example";
  const source = message(viewer, channelId, "Launch decisions", 1_700_000_000);
  const events: RelayEvent[] = [
    metadata(authority, channelId, "Launch", undefined, [["t", "stream"]]),
    roster(authority, channelId, [viewer.pubkey]),
    source,
  ];
  const createStarted = gate(),
    createHeld = gate();
  let creations = 0;
  const publish = vi.fn(async (event: RelayEvent) => {
    if (event.kind === 9007) {
      createStarted.resolve();
      await createHeld.promise;
      if (refuseFirstCreate && ++creations === 1)
        throw new PublishRejected("Creation refused by fixture");
      const id = event.tags.find(([tag]) => tag === "h")?.[1] ?? "";
      events.push(
        metadata(authority, id, "Catch-up", undefined, [
          ["private"],
          ["t", "stream"],
          ["t", "buzz.solo"],
        ]),
        // The Solo chat's roster holds the agent it was created with.
        roster(authority, id, [
          viewer.pubkey,
          ...(asked ? [other.pubkey] : [agent.pubkey]),
        ]),
      );
    }
    events.push(event);
  });
  const local = localAgentsFixture([
    {
      pubkey: agent.pubkey,
      name: "Pollen",
      relayUrl: origin,
      owner: viewer.pubkey,
    },
    ...(asked
      ? [
          {
            pubkey: other.pubkey,
            name: asked,
            relayUrl: origin,
            owner: viewer.pubkey,
          },
        ]
      : []),
  ]);
  const owner = createRelaySession(
    {
      viewer: viewer.pubkey,
      relayAuthor: authority.pubkey,
      scope: origin,
      channelIdentity: true,
      media: () => undefined,
      query: async (filters) => {
        const result = events.filter((event) =>
          filters.some((filter) => matchesEvent(event, filter)),
        );
        for (const filter of filters)
          for (const id of filter["#h"] ?? [])
            if (filter.kinds?.includes(9))
              result.push(
                bounds(authority, id, "head", {
                  has_more: false,
                  next_cursor: null,
                }),
              );
        return result;
      },
      writer: {
        kinds: [9, 9007],
        sign: async (event) => signed(viewer, event),
        publish,
      },
    },
    { agentChoices: local, outboxStorage: { load: () => [], save() {} } },
  );
  dispose.push(owner.dispose);
  await owner.session.channels.ensureList();
  setDefaultAgent(owner.session.scope, agent.pubkey);
  let snapshot: RelaySnapshot = {
    status: "ready",
    generation: 1,
    session: owner.session,
    scope: owner.session.scope,
    viewer: viewer.pubkey,
  };
  const listeners = new Set<() => void>();
  const relay: RelayData = {
    snapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retry() {},
    disconnect() {},
    clearCache: async () => {},
  };
  const open = vi.fn(async (_target?: unknown) => ({
    status: "opened" as const,
  }));
  const empty: readonly never[] = [];
  const contribution = { snapshot: () => empty, subscribe: () => () => {} };
  const host = {
    relay,
    navigation: { open },
    panels: {
      snapshot: () => empty,
      subscribe: () => () => {},
      resolve: () => undefined,
    },
  } as unknown as ConversationHostServices;
  // The conversation host registers itself for composer asks.
  if (asked)
    dispose.push(
      registerCatchUpHost(host, { tools: contribution, inline: contribution }),
    );
  const rows = foldMessages(channelId, authority.pubkey, [source]);
  const row = rows[0];
  if (!row) throw new Error("Missing source");
  const sourceRow = row;
  function Reader() {
    const catchUp = useCatchUp();
    const [channel, setChannel] = useState("Launch");
    const [asking, setAsking] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() =>
            take
              ? setAsking(true)
              : catchUp?.open({
                  session: owner.session,
                  message: sourceRow,
                  host,
                  extensions: { tools: contribution, inline: contribution },
                })
          }
        >
          Catch me up
        </button>
        {asked && (
          <button
            type="button"
            onClick={() =>
              catchUp?.ask(owner.session, {
                agent: { pubkey: other.pubkey, name: asked },
                question: "Is launch still Thursday?",
                channelId,
                channelName: "Launch",
              })
            }
          >
            Ask in a Solo chat
          </button>
        )}
        <button type="button" onClick={() => setChannel("Another channel")}>
          Browse another channel
        </button>
        <p>{channel}</p>
        {asking && (
          <AskBestie
            message={sourceRow}
            session={owner.session}
            host={host}
            extensions={{ tools: contribution, inline: contribution }}
            anchor={document.body}
            close={() => setAsking(false)}
            canOpen={() => false}
            open={() => false}
          />
        )}
      </>
    );
  }
  const pages = [{ key: "buzz.bestie/bestie" }] as RegisteredPage[];
  if (take) sessionStorage.setItem("buzz.dev.bestie-take", take);
  const content = (
    <CatchUpProvider pages={pages} relay={relay}>
      <CatchUpLauncher />
      {take && (
        <>
          <BestieTakePicker />
          <BestieHome
            place="top-nav"
            relay={relay}
            onSetup={() => {}}
            onOpenConversation={(channelId) => {
              void open({ channelId });
            }}
          />
          <BestieHome
            place="floating"
            relay={relay}
            onSetup={() => {}}
            onOpenConversation={(channelId) => {
              void open({ channelId });
            }}
          />
        </>
      )}
      <CatchUpFrame>
        <Reader />
      </CatchUpFrame>
    </CatchUpProvider>
  );
  const view = render(
    <StrictMode>
      <ToastProvider>
        {take ? (
          <BestieExperiment>
            <BestieAsksProvider relay={relay} enabled>
              {content}
            </BestieAsksProvider>
          </BestieExperiment>
        ) : (
          content
        )}
      </ToastProvider>
    </StrictMode>,
  );
  return {
    ...view,
    owner,
    relay,
    row,
    source,
    agent,
    other,
    host,
    publish,
    events,
    createStarted,
    createHeld,
    update(
      patch: { [K in keyof RelaySnapshot]?: RelaySnapshot[K] | undefined },
    ) {
      const next = { ...snapshot, ...patch };
      if (next.scope === undefined) delete next.scope;
      if (next.viewer === undefined) delete next.viewer;
      snapshot = next as RelaySnapshot;
      for (const listener of listeners) listener();
    },
  };
}

it("keeps one submitted exchange while browsing, hiding and reopening in StrictMode", async () => {
  const f = await fixture();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Catch me up" }));
  await f.createStarted.promise;
  try {
    expect(
      screen.getByRole("region", { name: "Bestie catch-up" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Browse another channel" }),
    );
    expect(screen.getByText("Another channel")).toBeVisible();
    const panel = screen.getByRole("region", { name: "Bestie catch-up" });
    expect(within(panel).getByText("Launch decisions")).toBeVisible();
    await user.click(
      within(panel).getByRole("button", { name: "Hide Bestie catch-up" }),
    );
    expect(
      screen.queryByRole("region", { name: "Bestie catch-up" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Show Bestie catch-up" }),
    );
    await user.click(screen.getByRole("button", { name: "Catch me up" }));
    expect(
      f.publish.mock.calls.filter(([event]) => event.kind === 9007),
    ).toHaveLength(1);
  } finally {
    await act(async () => f.createHeld.resolve());
  }
  await waitFor(() =>
    expect(
      f.publish.mock.calls.filter(([event]) => event.kind === 9),
    ).toHaveLength(1),
  );
  await screen.findByRole("textbox", { name: "Message Pollen" });
  const prompt = f.publish.mock.calls.find(([event]) => event.kind === 9)?.[0];
  expect(prompt?.content).toContain(f.source.id);
  expect(prompt?.tags).toContainEqual(["p", f.agent.pubkey]);
  const launcher = screen.getAllByRole("button", {
    name: "Hide Bestie catch-up",
  })[0];
  if (!launcher) throw new Error("Missing catch-up launcher");
  await user.click(launcher);
  const reopen = screen.getByRole("button", { name: "Show Bestie catch-up" });
  await user.click(reopen);
  await user.keyboard("{Escape}");
  expect(reopen).toHaveFocus();
  expect(
    f.publish.mock.calls.filter(([event]) => event.kind === 9),
  ).toHaveLength(1);
});

it("retires the presentation on community change and fences a late submission", async () => {
  const f = await fixture();
  await userEvent.click(screen.getByRole("button", { name: "Catch me up" }));
  await f.createStarted.promise;
  await act(async () =>
    f.update({ scope: `https://another.example:${f.owner.session.viewer}` }),
  );
  expect(
    screen.queryByRole("region", { name: "Bestie catch-up" }),
  ).not.toBeInTheDocument();
  await act(async () => f.createHeld.resolve());
  await waitFor(() =>
    expect(
      f.publish.mock.calls.filter(([event]) => event.kind === 9007),
    ).toHaveLength(1),
  );
  // The old create finished, but may not produce a new message after retirement.
  await act(async () => {
    await f.owner.session.outbox?.ready();
  });
  expect(
    f.publish.mock.calls.filter(([event]) => event.kind === 9),
  ).toHaveLength(0);
});

it("asks explicitly, keeps navigation in place and reopens the same conversation across placements", async () => {
  const f = await fixture("top-nav");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Catch me up" }));
  let form = await screen.findByRole("dialog", { name: "Ask Pollen" });
  await user.click(within(form).getByRole("button", { name: "Catch me up" }));
  expect(
    (within(form).getByRole("textbox") as HTMLTextAreaElement).value,
  ).toContain("Catch me up on this post");
  await user.click(
    within(form).getByRole("button", { name: "Close Ask Bestie" }),
  );
  expect(f.publish).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Catch me up" }));
  form = await screen.findByRole("dialog", { name: "Ask Pollen" });
  await user.type(
    within(form).getByRole("textbox"),
    "What is blocking launch?",
  );
  await user.click(within(form).getByRole("button", { name: "Send" }));
  await f.createStarted.promise;
  try {
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Ask Pollen" })).toBeNull(),
    );
    expect(f.host.navigation.open).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Browse another channel" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Open Pollen — Bestie/ }),
    );
    const home = await screen.findByRole("dialog", { name: "Pollen" });
    await user.click(
      within(home).getByRole("button", { name: /What is blocking launch/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Pollen" }),
    ).toHaveTextContent("Preparing your conversation");
  } finally {
    await act(async () => f.createHeld.resolve());
  }
  await screen.findByRole("textbox", { name: "Message Pollen" });
  await waitFor(() =>
    expect(
      f.publish.mock.calls.filter(([event]) => event.kind === 9),
    ).toHaveLength(1),
  );
  const sent = f.publish.mock.calls.find(([event]) => event.kind === 9)?.[0];
  expect(sent?.content).toContain("What is blocking launch?");
  expect(sent?.content).toContain(f.source.id);
  expect(sent?.tags).toContainEqual(["p", f.agent.pubkey]);
  await user.click(screen.getByRole("button", { name: "Close Bestie" }));
  await user.click(screen.getByRole("combobox", { name: "Bestie prototype" }));
  await user.click(
    await screen.findByRole("option", { name: "Floating avatar" }),
  );
  await user.click(
    screen.getByRole("button", { name: /Open Pollen — Bestie/ }),
  );
  await user.click(
    screen.getByRole("button", { name: /What is blocking launch/ }),
  );
  const composer = await screen.findByRole("textbox", {
    name: "Message Pollen",
  });
  await user.type(composer, "Keep this draft");
  await user.click(screen.getByRole("button", { name: "Back to Bestie" }));
  await user.click(
    screen.getByRole("button", { name: /What is blocking launch/ }),
  );
  expect(
    await screen.findByRole("textbox", { name: "Message Pollen" }),
  ).toHaveTextContent("Keep this draft");
  await user.click(screen.getByRole("button", { name: "Open conversation" }));
  expect(f.host.navigation.open).toHaveBeenCalledTimes(1);
  expect(
    f.publish.mock.calls.filter(([event]) => event.kind === 9007),
  ).toHaveLength(1);
  expect(
    f.publish.mock.calls.filter(([event]) => event.kind === 9),
  ).toHaveLength(1);
});

it("does not send a new ask after its community is replaced during creation", async () => {
  const f = await fixture("floating");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Catch me up" }));
  const form = await screen.findByRole("dialog", { name: "Ask Pollen" });
  await user.type(within(form).getByRole("textbox"), "Explain this decision");
  await user.click(within(form).getByRole("button", { name: "Send" }));
  await f.createStarted.promise;
  try {
    await act(async () =>
      f.update({ scope: `https://another.example:${f.owner.session.viewer}` }),
    );
  } finally {
    await act(async () => f.createHeld.resolve());
  }
  await act(async () => {
    await f.owner.session.outbox?.ready();
  });
  expect(
    f.publish.mock.calls.filter(([event]) => event.kind === 9),
  ).toHaveLength(0);
  await user.click(
    screen.getByRole("button", { name: /Open Pollen — Bestie/ }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Pollen" }),
  ).not.toHaveTextContent("Explain this decision");
});

it("withholds source previews without an account scope and restores same-account asks without resending", async () => {
  const f = await fixture("top-nav");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Catch me up" }));
  const form = await screen.findByRole("dialog", { name: "Ask Pollen" });
  await user.type(within(form).getByRole("textbox"), "Private launch question");
  await user.click(within(form).getByRole("button", { name: "Send" }));
  await f.createStarted.promise;
  await act(async () => f.createHeld.resolve());
  await waitFor(() =>
    expect(
      f.publish.mock.calls.filter(([event]) => event.kind === 9),
    ).toHaveLength(1),
  );
  await user.click(
    screen.getByRole("button", { name: /Open Pollen — Bestie/ }),
  );
  await user.click(
    screen.getByRole("button", { name: /Private launch question/ }),
  );
  await screen.findByRole("textbox", { name: "Message Pollen" });
  await act(async () =>
    f.update({ status: "connecting", scope: undefined, viewer: undefined }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Pollen" })).toBeNull(),
  );
  await user.click(
    screen.getByRole("button", { name: /Open Pollen — Bestie/ }),
  );
  expect(screen.queryByText("Private launch question")).toBeNull();
  await act(async () =>
    f.update({
      status: "ready",
      scope: f.owner.session.scope,
      viewer: f.owner.session.viewer,
    }),
  );
  await user.click(
    screen.getByRole("button", { name: /Open Pollen — Bestie/ }),
  );
  expect(
    await screen.findByRole("button", { name: /Private launch question/ }),
  ).toBeInTheDocument();
  expect(
    f.publish.mock.calls.filter(([event]) => event.kind === 9),
  ).toHaveLength(1);
});

it("retries a definitively refused creation as one fresh chat while keeping its question", async () => {
  const f = await fixture("floating", true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Catch me up" }));
  const form = await screen.findByRole("dialog", { name: "Ask Pollen" });
  await user.type(within(form).getByRole("textbox"), "Can we still launch?");
  await user.click(within(form).getByRole("button", { name: "Send" }));
  await f.createStarted.promise;
  await act(async () => f.createHeld.resolve());
  await user.click(
    screen.getByRole("button", { name: /Open Pollen — Bestie/ }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: /Can we still launch.*Couldn’t start/,
    }),
  );
  await user.click(await screen.findByRole("button", { name: "Try again" }));
  await screen.findByRole("textbox", { name: "Message Pollen" });
  await waitFor(() =>
    expect(
      f.publish.mock.calls.filter(([event]) => event.kind === 9),
    ).toHaveLength(1),
  );
  const creates = f.publish.mock.calls
    .filter(([event]) => event.kind === 9007)
    .map(([event]) => event);
  expect(creates).toHaveLength(2);
  expect(creates[0]?.tags.find(([key]) => key === "h")?.[1]).not.toEqual(
    creates[1]?.tags.find(([key]) => key === "h")?.[1],
  );
  expect(
    f.publish.mock.calls.find(([event]) => event.kind === 9)?.[0].content,
  ).toContain("Can we still launch?");
});

async function askAndSend(f: Awaited<ReturnType<typeof fixture>>) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Ask in a Solo chat" }));
  await f.createStarted.promise;
  await act(async () => f.createHeld.resolve());
  await waitFor(() =>
    expect(
      f.publish.mock.calls.filter(([event]) => event.kind === 9),
    ).toHaveLength(1),
  );
  const sent = f.publish.mock.calls.find(([event]) => event.kind === 9)?.[0];
  expect(sent?.tags).toContainEqual(["p", f.other.pubkey]);
  return user;
}
const launcher = () =>
  document.querySelector<HTMLElement>("[data-catch-up-launcher]");

it.each(["floating", "top-nav", "current"] as const)(
  "leaves no launcher behind once a sent ask's panel closes (%s)",
  async (take) => {
    const f = await fixture(take, false, { asked: "Clover" });
    const user = await askAndSend(f);
    const panel = screen.getByRole("region", { name: "Bestie catch-up" });
    await user.click(
      within(panel).getByRole("button", { name: "Hide Bestie catch-up" }),
    );
    // The Solo chat stays under Solo in the sidebar; nothing here reopens it.
    await waitFor(() => expect(launcher()).toBeNull());
    expect(
      screen.queryByRole("region", { name: "Bestie catch-up" }),
    ).not.toBeInTheDocument();
  },
);

it("names the asked agent, not the Bestie, on a launcher for an ask", async () => {
  const f = await fixture("current", false, { asked: "Clover" });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Ask in a Solo chat" }));
  await f.createStarted.promise;
  try {
    const shown = launcher();
    expect(shown).toHaveAccessibleName("Hide Solo chat with Clover");
    // Clover's avatar (its initial), not Pollen's.
    expect(shown).toHaveTextContent(/^C$/);
    // Hidden before its question is sent, the ask is kept so it still sends.
    await user.click(
      screen.getByRole("button", { name: "Hide Solo chat with Clover" }),
    );
    expect(launcher()).toHaveAccessibleName("Show Solo chat with Clover");
  } finally {
    await act(async () => f.createHeld.resolve());
  }
  await waitFor(() =>
    expect(
      f.publish.mock.calls.filter(([event]) => event.kind === 9),
    ).toHaveLength(1),
  );
  await waitFor(() => expect(launcher()).toBeNull());
});
