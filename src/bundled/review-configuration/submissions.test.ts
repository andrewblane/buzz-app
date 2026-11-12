import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "nostr-tools/utils";
import { createOutbox, type OutgoingEvent } from "../../features/relay/outbox";
import type { EventData, ReadFilter } from "../../features/relay/events";
import type { RelaySession } from "../../features/relay/session";
import { keypair, signed } from "../../features/relay/testing";
import { loadSubmissions, pullRequest, submitReview } from "./submissions";
import type { SavedReviewConfig } from "./configuration";

const channel = "11111111-1111-4111-8111-111111111111";
const cleanups: (() => void)[] = [];
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  let queue = Promise.resolve();
  vi.stubGlobal("navigator", {
    locks: {
      request: (
        _key: string,
        _options: unknown,
        run: () => Promise<unknown>,
      ) => {
        const task = queue.then(run);
        queue = task.then(
          () => {},
          () => {},
        );
        return task;
      },
    },
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

async function fixture() {
  const owner = keypair(),
    agent = keypair();
  const proof = bytesToHex(
    schnorr.sign(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(`nostr:agent-auth:${agent.pubkey}:`),
        ),
      ),
      owner.secret,
    ),
  );
  let profile = signed(agent, {
    kind: 0,
    content: "{}",
    tags: [["auth", owner.pubkey, "", proof]],
  });
  const heads = new Map<string, EventData>();
  const messages = new Map<string, EventData>();
  let journal: readonly OutgoingEvent[] = [];
  const publish = vi.fn(async (event: EventData) => {
    messages.set(event.id, event);
  });
  const box = createOutbox(
    owner.pubkey,
    { sign: async (template) => signed(owner, template), publish },
    {
      load: () => structuredClone(journal),
      save: (next) => {
        journal = structuredClone(next);
      },
    },
  );
  cleanups.push(box.dispose);
  const artifactPublish = vi.fn(async (event: EventData) => {
    const id = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    const previous = heads.get(id);
    if (event.tags.find((tag) => tag[0] === "prev")?.[1] !== previous?.id)
      throw new Error("stale revision");
    heads.set(id, event);
    return event.id;
  });
  const session = {
    viewer: owner.pubkey,
    scope: `https://example.org:${owner.pubkey}`,
    outbox: box.outbox,
    agentChoices: {
      refresh: async () => {},
      snapshot: () => ({
        archives: { status: "ready" },
        selectable: [{ pubkey: agent.pubkey }],
      }),
    },
    snapshotRead: vi.fn(async (filters: ReadFilter[]) => {
      const filter = filters[0];
      if (!filter) throw new Error("Missing filter");
      if (filter.artifact && filter.consistency)
        throw new Error("unsupported artifact predicate");
      if (filter.kinds?.includes(0)) return [profile];
      if (filter.kinds?.includes(9))
        return [...messages.values()].filter((event) =>
          filter.ids?.includes(event.id),
        );
      return [...heads.values()].filter(
        (event) =>
          !filter["#d"] ||
          filter["#d"].includes(
            event.tags.find((tag) => tag[0] === "d")?.[1] ?? "",
          ),
      );
    }),
    configArtifactWriter: {
      sign: async (template: Parameters<typeof signed>[1]) =>
        signed(owner, template),
      publish: artifactPublish,
    },
  } as unknown as RelaySession;
  const config: SavedReviewConfig = {
    revision: "c".repeat(64),
    artifactId: "config",
    config: {
      version: 1,
      repository: "example-org/project",
      reminderMinutes: 15,
      lanes: [
        {
          id: "backend",
          name: "Backend",
          instructions: "Check authorization and tests.",
          reviewers: [agent.pubkey],
        },
        {
          id: "ui",
          name: "UI",
          instructions: "Check keyboard access.",
          reviewers: [agent.pubkey],
        },
      ],
    },
  };
  const run = (
    input = "123",
    signal = new AbortController().signal,
    resume = false,
  ) =>
    submitReview(
      session,
      channel,
      config,
      input,
      [agent.pubkey, agent.pubkey],
      signal,
      () => {},
      resume,
    );
  return {
    owner,
    agent,
    heads,
    messages,
    session,
    config,
    run,
    publish,
    artifactPublish,
    box,
    loseJournal() {
      box.dispose();
      journal = [];
      const replacement = createOutbox(
        owner.pubkey,
        { sign: async (template) => signed(owner, template), publish },
        { load: () => [], save: () => {} },
      );
      cleanups.push(replacement.dispose);
      (session as { outbox: typeof replacement.outbox }).outbox =
        replacement.outbox;
    },
    changeOwner() {
      profile = signed(agent, { kind: 0, content: "{}", tags: [] });
    },
  };
}

it("validates canonical PR input and refuses other repositories or non-PR URLs", () => {
  expect(pullRequest("#42", "example-org/project")).toBe(42);
  expect(
    pullRequest(
      "https://github.com/Example-Org/Project/pull/42/",
      "example-org/project",
    ),
  ).toBe(42);
  for (const input of [
    "0",
    "1.5",
    "9007199254740992",
    "https://github.com/other/project/pull/1",
    "https://github.com/example-org/project/issues/1",
    "https://user@github.com/example-org/project/pull/1",
    "https://github.com/example-org/project/pull/1?x=2",
  ])
    expect(() => pullRequest(input, "example-org/project")).toThrow();
});

it("saves the instruction snapshot and creates one overview plus distinct lane threads", async () => {
  const f = await fixture();
  const record = await f.run();
  expect(record.value.threads.every((thread) => thread.delivered)).toBe(true);
  expect(f.messages.size).toBe(3);
  const messages = [...f.messages.values()];
  expect(messages[0]?.tags.some((tag) => tag[0] === "p")).toBe(false);
  for (const [index, message] of messages.slice(1).entries()) {
    expect(message.tags).toContainEqual(["p", f.agent.pubkey]);
    expect(message.tags.some((tag) => tag[0] === "e")).toBe(false);
    expect(message.content).toContain(
      f.config.config.lanes[index]?.instructions,
    );
    expect(message.content).toContain(record.value.threads[0]?.id);
  }
  expect(
    (await loadSubmissions(f.session, channel, new AbortController().signal))
      .rows[0],
  ).toEqual(record);
  await f.run();
  expect(f.publish).toHaveBeenCalledTimes(3);
});

it("serializes simultaneous submissions of the same PR", async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([f.run(), f.run()]);
  expect(first.value.threads).toEqual(second.value.threads);
  expect(f.messages.size).toBe(3);
});

it("retries the same signed event after ambiguous publication without duplicating threads", async () => {
  const f = await fixture();
  f.publish.mockImplementationOnce(async (event) => {
    f.messages.set(event.id, event);
    throw new Error("Receipt lost");
  });
  await expect(f.run()).rejects.toThrow();
  const firstId = f.publish.mock.calls[0]?.[0].id;
  await f.run("123", undefined, true);
  expect(f.publish.mock.calls[1]?.[0].id).toBe(firstId);
  expect(f.messages.size).toBe(3);
});

it("recovers a send whose artifact update failed before its ID was saved", async () => {
  const f = await fixture();
  const original = f.artifactPublish.getMockImplementation();
  if (!original) throw new Error("Missing fixture publisher");
  f.artifactPublish
    .mockImplementationOnce(original)
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(new Error("save interrupted"));
  await expect(f.run()).rejects.toThrow("save interrupted");
  await f.run("123", undefined, true);
  expect(f.messages.size).toBe(3);
  expect(f.publish).toHaveBeenCalledTimes(3);
});

it("does not take over incomplete delivery after browser recovery storage is lost", async () => {
  const f = await fixture();
  f.publish.mockRejectedValueOnce(new Error("offline"));
  await expect(f.run()).rejects.toThrow();
  localStorage.setItem(
    `buzz.review.device:${f.session.scope}`,
    crypto.randomUUID(),
  );
  await expect(f.run("123", undefined, true)).rejects.toThrow(
    "original browser profile",
  );
  expect(f.publish).toHaveBeenCalledTimes(1);
});

it("refuses unattested reviewers before saving or sending", async () => {
  const f = await fixture();
  f.changeOwner();
  await expect(f.run()).rejects.toThrow("verified ownership");
  expect(f.heads.size).toBe(0);
  expect(f.publish).not.toHaveBeenCalled();
});

it("stops on cancellation and resumes only the saved message IDs", async () => {
  const f = await fixture();
  const controller = new AbortController();
  f.publish.mockImplementationOnce(async (event) => {
    f.messages.set(event.id, event);
    controller.abort();
  });
  await expect(f.run("123", controller.signal)).rejects.toThrow();
  const firstId = f.publish.mock.calls[0]?.[0].id;
  await f.run("123", undefined, true);
  expect(f.messages.has(firstId ?? "")).toBe(true);
  expect(f.messages.size).toBe(3);
});

it("opens an existing incomplete record without sending a changed preview", async () => {
  const f = await fixture();
  f.publish.mockRejectedValueOnce(new Error("offline"));
  await expect(f.run()).rejects.toThrow();
  const changed = {
    ...f.config,
    config: {
      ...f.config.config,
      lanes: f.config.config.lanes.map((lane) => ({
        ...lane,
        instructions: "New instructions",
      })),
    },
  };
  const record = await submitReview(
    f.session,
    channel,
    changed,
    "123",
    [f.agent.pubkey, f.agent.pubkey],
    new AbortController().signal,
    () => {},
  );
  expect(record.value.config.lanes[0]?.instructions).toBe(
    "Check authorization and tests.",
  );
  expect(f.publish).toHaveBeenCalledTimes(1);
});

it("fails closed when a sent message loses its journal before its ID was saved", async () => {
  const f = await fixture();
  const original = f.artifactPublish.getMockImplementation();
  if (!original) throw new Error("Missing fixture publisher");
  f.artifactPublish
    .mockImplementationOnce(original)
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(new Error("save interrupted"));
  await expect(f.run()).rejects.toThrow("save interrupted");
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalledTimes(1));
  f.loseJournal();
  await expect(f.run("123", undefined, true)).rejects.toThrow(
    "recovery journal is missing",
  );
  expect(f.publish).toHaveBeenCalledTimes(1);
});

it("can resume after a proven rejection before enqueue", async () => {
  const f = await fixture();
  const send = vi.fn(f.box.outbox.send).mockImplementationOnce(() => {
    throw new Error("Outbox full");
  });
  (f.session as { outbox: typeof f.box.outbox }).outbox = {
    ...f.box.outbox,
    send,
  };
  await expect(f.run()).rejects.toThrow("Outbox full");
  const saved = (
    await loadSubmissions(f.session, channel, new AbortController().signal)
  ).rows[0];
  expect(saved?.value.threads[0]).toEqual({});
  await f.run("123", undefined, true);
  expect(f.messages.size).toBe(3);
});
