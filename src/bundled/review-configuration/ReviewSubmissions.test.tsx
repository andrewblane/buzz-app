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
