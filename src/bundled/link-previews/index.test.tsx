// @vitest-environment jsdom
import { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, it, vi } from "vitest";
import { PluginRuntime } from "../../plugins/runtime";
import { resolveMatch } from "../../plugins/contributions";
import { ConversationService } from "../../features/conversation/service";
import { setShowGitHubCards } from "../github/card-preference";
import * as previews from "./index";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await dispose();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("filters all GitHub pages, restores the registration, and disposes its listener", async () => {
  vi.stubGlobal("isTauri", true);
  const root = new Context();
  root.provide("host", {
    readPage: async () => null,
    requestBytes: async () => null,
  } as never);
  const runtime = new PluginRuntime(root, async () => previews);
  const conversation = new ConversationService(root);
  cleanups.push(async () => {
    await runtime.dispose();
    await root.fiber.dispose();
  });
  const plugin = {
    manifest: {
      id: "buzz.link-previews",
      name: "Link previews",
      apiVersion: 1 as const,
    },
    enabled: true,
    source: "bundled" as const,
    revision: "one",
    previous: null,
    reloadable: false,
    error: null,
  };
  const urls = [
    "https://github.com/example-org/project/pull/1",
    "https://github.com/example-org/project/issues/2#issuecomment-3",
    "https://github.com/example-org/project/commit/abcdef1",
    "https://github.com/example-org/project",
    "https://github.com/example-user",
    "https://GitHub.com./example-org/project/pull/1",
  ];
  const match = (url: string) =>
    resolveMatch(conversation.linkPreviews.snapshot(), url);
  runtime.reconcile([plugin]);
  await vi.waitFor(() =>
    expect(conversation.linkPreviews.snapshot()).toHaveLength(1),
  );
  for (const url of urls) expect(match(url)).toBeDefined();
  setShowGitHubCards(false);
  await vi.waitFor(() => {
    expect(conversation.linkPreviews.snapshot()).toHaveLength(1);
    for (const url of urls) expect(match(url)).toBeUndefined();
  });
  expect(match("https://github.com.example.org/")).toBeDefined();
  expect(match("https://news.example.org/")).toBeDefined();
  // A rapid on/off sequence must leave one current registration.
  setShowGitHubCards(true);
  setShowGitHubCards(false);
  setShowGitHubCards(true);
  await vi.waitFor(() => {
    expect(conversation.linkPreviews.snapshot()).toHaveLength(1);
    for (const url of urls) expect(match(url)).toBeDefined();
  });
  runtime.reconcile([]);
  await vi.waitFor(() =>
    expect(conversation.linkPreviews.snapshot()).toHaveLength(0),
  );
  setShowGitHubCards(false);
  expect(conversation.linkPreviews.snapshot()).toHaveLength(0);
  runtime.reconcile([plugin]);
  await vi.waitFor(() => {
    expect(conversation.linkPreviews.snapshot()).toHaveLength(1);
    for (const url of urls) expect(match(url)).toBeUndefined();
  });
});
