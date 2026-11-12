// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import type { RelaySession } from "../../features/relay/session";
import { ReviewSubmissions } from "./ReviewSubmissions";
import type { SavedReviewConfig } from "./configuration";

afterEach(cleanup);

it("waits for list reads before offering submission and restores trigger focus on cancel", async () => {
  let finish: (events: []) => void = () => {};
  const pending = new Promise<[]>((resolve) => {
    finish = resolve;
  });
  const choices = {
    pending: false,
    selectable: [{ pubkey: "a".repeat(64), name: "Reviewer" }],
    archives: { status: "ready" },
  };
  const session = {
    snapshotRead: () => pending,
    agentChoices: {
      subscribe: () => () => {},
      snapshot: () => choices,
      retain: () => () => {},
      ensure() {},
    },
  } as unknown as RelaySession;
  const configuration: SavedReviewConfig = {
    revision: "b".repeat(64),
    artifactId: "config",
    config: {
      version: 1,
      repository: "example-org/project",
      reminderMinutes: 15,
      lanes: [
        {
          id: "general",
          name: "General",
          instructions: "Check tests.",
          reviewers: ["a".repeat(64)],
        },
      ],
    },
  };
  render(
    <ReviewSubmissions
      session={session}
      channel="channel"
      configurations={[configuration]}
      disabled={false}
      writable
      onEditingChange={() => {}}
    />,
  );
  const submit = screen.getByRole("button", {
    name: "Submit PR",
  }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  await act(async () => finish([]));
  expect(submit.disabled).toBe(false);
  const user = userEvent.setup();
  await user.click(submit);
  expect(screen.getByRole("textbox", { name: "Pull request" })).toBe(
    document.activeElement,
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(submit);
});

it("clears changed PR previews, blocks unmatched lanes, and rechecks facts before any write", async () => {
  const { vi } = await import("vitest");
  const choices = {
    pending: false,
    selectable: [{ pubkey: "a".repeat(64), name: "Reviewer" }],
    archives: { status: "ready" },
  };
  const snapshotRead = vi.fn(async () => []);
  const publish = vi.fn();
  const session = {
    snapshotRead,
    configArtifactWriter: { publish },
    agentChoices: {
      subscribe: () => () => {},
      snapshot: () => choices,
      retain: () => () => {},
      ensure() {},
    },
  } as unknown as RelaySession;
  const configuration: SavedReviewConfig = {
    revision: "b".repeat(64),
    artifactId: "config",
    config: {
      version: 1,
      repository: "example-org/project",
      reminderMinutes: 15,
      lanes: [
        {
          id: "ui",
          name: "UI",
          instructions: "Check keyboard navigation.",
          reviewers: ["a".repeat(64)],
          routing: {
            mode: "all",
            rules: [
              { id: "ui", field: "title", operator: "contains", value: "UI" },
            ],
          },
        },
      ],
    },
  };
  const facts = {
    repository: "example-org/project",
    pr: 42,
    title: "Improve UI",
    labels: [],
    changedFiles: 1,
    paths: ["src/ui.tsx"],
    head: "a".repeat(40),
    base: "b".repeat(40),
  };
  const readPull = vi.fn(async () => facts);
  render(
    <ReviewSubmissions
      session={session}
      channel="channel"
      configurations={[configuration]}
      disabled={false}
      writable
      onEditingChange={() => {}}
      readPull={readPull}
    />,
  );
  const user = userEvent.setup();
  await act(async () => {});
  await user.click(screen.getByRole("button", { name: "Submit PR" }));
  const input = screen.getByRole("textbox", { name: "Pull request" });
  const start = screen.getByRole("button", {
    name: "Start review threads",
  }) as HTMLButtonElement;
  await user.type(input, "42");
  expect(start.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Load PR details" }));
  await screen.findByText("Matching lanes: UI");
  expect(start.disabled).toBe(false);
  await user.type(input, "3");
  expect(start.disabled).toBe(true);
  expect(screen.queryByText("Matching lanes: UI")).toBeNull();
  await user.clear(input);
  await user.type(input, "42");
  readPull.mockResolvedValueOnce({ ...facts, title: "Backend change" });
  await user.click(screen.getByRole("button", { name: "Load PR details" }));
  await screen.findByText(/Matching lanes: None/);
  expect(start.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Load PR details" }));
  await screen.findByText("Matching lanes: UI");
  readPull.mockResolvedValueOnce({ ...facts, head: "c".repeat(40) });
  await user.click(start);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "The PR changed",
  );
  expect(publish).not.toHaveBeenCalled();
  expect(snapshotRead).toHaveBeenCalledTimes(1);
});
