// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RelaySession } from "../../features/relay/session";
import { ReviewSubmissions } from "./ReviewSubmissions";
import { loadConfigurations, type SavedReviewConfig } from "./configuration";
import {
  loadSubmissions,
  submitReview,
  type SavedSubmission,
} from "./submissions";

vi.mock("./configuration", async (original) => ({
  ...(await original<typeof import("./configuration")>()),
  loadConfigurations: vi.fn(),
}));
vi.mock("./submissions", async (original) => ({
  ...(await original<typeof import("./submissions")>()),
  loadSubmissions: vi.fn(),
  submitReview: vi.fn(),
}));
afterEach(cleanup);
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
        instructions: "Check keyboard access.",
        reviewers: ["a".repeat(64)],
      },
    ],
  },
};
const record: SavedSubmission = {
  artifactId: "submission",
  revision: "c".repeat(64),
  value: {
    version: 2,
    pr: 42,
    config: configuration.config,
    configRevision: configuration.revision,
    submitter: "d".repeat(64),
    device: "device",
    threads: [{ id: "e".repeat(64), delivered: true }],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadConfigurations).mockResolvedValue({
    rows: [configuration],
    unreadable: 0,
    truncated: false,
  });
  vi.mocked(loadSubmissions).mockResolvedValue({ rows: [], warning: "" });
  vi.mocked(submitReview).mockImplementation(
    async (_s, _c, _config, _pr, _r, _signal, progress, _resume, facts) => {
      if (typeof facts === "function") await facts();
      progress({ ...record, value: { ...record.value, threads: [{}] } });
      progress(record);
      return record;
    },
  );
});
function fixture() {
  const agents = [{ pubkey: "a".repeat(64), name: "UI Reviewer" }];
  const choices = {
    identities: agents,
    selectable: agents,
    pending: false,
    archives: { status: "ready" },
  };
  const session = {
    agentChoices: {
      subscribe: () => () => {},
      snapshot: () => choices,
      retain: () => () => {},
      ensure() {},
    },
  } as unknown as RelaySession;
  const readPull = vi.fn(async () => ({
    repository: "example-org/project",
    pr: 42,
    title: "UI change",
    labels: ["ui"],
    changedFiles: 1,
    paths: ["ui.tsx"],
    head: "a".repeat(40),
    base: "b".repeat(40),
  }));
  const onOpenThread = vi.fn(async () => {});
  const editing = vi.fn();
  const view = render(
    <ReviewSubmissions
      session={session}
      channel="channel"
      writable
      onEditingChange={editing}
      onOpenThread={onOpenThread}
      readPull={readPull}
    />,
  );
  return {
    ...view,
    session,
    readPull,
    onOpenThread,
    editing,
    user: userEvent.setup(),
  };
}
async function enter(
  user: ReturnType<typeof userEvent.setup>,
  url = "https://github.com/example-org/project/pull/42",
) {
  await user.type(screen.getByRole("textbox", { name: "GitHub PR URL" }), url);
  await user.click(screen.getByRole("button", { name: "Submit PR" }));
}
it("submits a URL in one action and shows assigned reviewers and working thread controls", async () => {
  const test = fixture();
  await enter(test.user);
  expect((await screen.findByRole("status")).textContent).toContain(
    "Submitted — reviewers assigned",
  );
  expect(test.readPull).toHaveBeenCalledWith(
    "example-org/project",
    42,
    expect.any(AbortSignal),
  );
  const result = screen.getByRole("region", { name: "Submission result" });
  expect(within(result).getByText("UI Reviewer")).toBeTruthy();
  await test.user.click(
    within(result).getByRole("button", { name: "Open UI thread" }),
  );
  expect(test.onOpenThread).toHaveBeenCalledWith("channel", "e".repeat(64));
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Load PR details" })).toBeNull();
});
it("keeps unknown repositories editable and never dispatches them", async () => {
  const test = fixture();
  await enter(test.user, "https://github.com/example-org/unknown/pull/42");
  expect((await screen.findByRole("alert")).textContent).toContain(
    "not configured",
  );
  expect(submitReview).not.toHaveBeenCalled();
  expect(test.readPull).not.toHaveBeenCalled();
  await test.user.clear(screen.getByRole("textbox", { name: "GitHub PR URL" }));
  await enter(test.user);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Submitted"),
  );
});
it("does not claim a repository is absent when configuration reads are incomplete", async () => {
  vi.mocked(loadConfigurations).mockResolvedValue({
    rows: [],
    unreadable: 1,
    truncated: false,
  });
  const test = fixture();
  await enter(test.user);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Could not confirm",
  );
  expect(submitReview).not.toHaveBeenCalled();
});
it("shows existing threads and only claims notifications after successful delivery", async () => {
  vi.mocked(submitReview).mockImplementation(
    async (
      _s,
      _c,
      _config,
      _pr,
      _r,
      _signal,
      progress,
      _resume,
      _facts,
      existing,
    ) => {
      existing?.();
      progress(record);
      return record;
    },
  );
  const test = fixture();
  await enter(test.user);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Already exists — reviewers notified",
    ),
  );
  expect(test.readPull).not.toHaveBeenCalled();
  vi.mocked(submitReview).mockImplementationOnce(
    async (
      _s,
      _c,
      _config,
      _pr,
      _r,
      _signal,
      progress,
      _resume,
      _facts,
      existing,
    ) => {
      existing?.();
      progress(record);
      throw new Error("Notification rejected");
    },
  );
  await test.user.click(screen.getByRole("button", { name: "Submit PR" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Notification rejected",
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("button", { name: "Open UI thread" })).toBeTruthy();
});
it("guards repeated clicks and aborts pending work when its page unmounts", async () => {
  let finish: () => void = () => {};
  let signal: AbortSignal | undefined;
  vi.mocked(submitReview).mockImplementationOnce(
    async (_s, _c, _config, _pr, _r, pending) => {
      signal = pending;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return record;
    },
  );
  const test = fixture();
  await enter(test.user);
  await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(1));
  await test.user.click(screen.getByRole("button", { name: "Submit PR" }));
  expect(submitReview).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
  test.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish());
});

it("focuses the URL after selecting a previous PR without dispatching", async () => {
  vi.mocked(loadSubmissions).mockResolvedValue({ rows: [record], warning: "" });
  const test = fixture();
  await test.user.click(
    await screen.findByRole("button", { name: /example-org\/project#42/ }),
  );
  await test.user.click(screen.getByRole("button", { name: "Use this PR" }));
  const input = screen.getByRole("textbox", { name: "GitHub PR URL" });
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe(
    "https://github.com/example-org/project/pull/42",
  );
  expect(submitReview).not.toHaveBeenCalled();
});
