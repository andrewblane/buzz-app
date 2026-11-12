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
  deleteSubmission,
  remindSubmission,
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
  deleteSubmission: vi.fn(),
  remindSubmission: vi.fn(),
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
function fixture(
  mode: "submit" | "all" = "submit",
  viewer = record.value.submitter,
) {
  const agents = [{ pubkey: "a".repeat(64), name: "UI Reviewer" }];
  const choices = {
    identities: agents,
    selectable: agents,
    pending: false,
    archives: { status: "ready" },
  };
  const session = {
    viewer,
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
      mode={mode}
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

it("shows all PRs in a table without submission controls, and deletion requires confirmation", async () => {
  vi.mocked(loadSubmissions).mockResolvedValue({ rows: [record], warning: "" });
  const test = fixture("all");
  const table = await screen.findByRole("table");
  expect(
    within(table).getByRole("columnheader", { name: "Reviewers & threads" }),
  ).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  await test.user.click(
    screen.getByRole("button", { name: "Delete example-org/project#42" }),
  );
  expect(deleteSubmission).not.toHaveBeenCalled();
  await test.user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByRole("table")).toBeTruthy();
  await test.user.click(
    screen.getByRole("button", { name: "Delete example-org/project#42" }),
  );
  await test.user.click(
    screen.getByRole("button", { name: "Delete submission" }),
  );
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  expect(deleteSubmission).toHaveBeenCalledWith(
    test.session,
    "channel",
    record,
    expect.any(AbortSignal),
  );
  expect(submitReview).not.toHaveBeenCalled();
});

it("keeps a row and explains recovery after an uncertain delete", async () => {
  vi.mocked(loadSubmissions).mockResolvedValue({ rows: [record], warning: "" });
  vi.mocked(deleteSubmission).mockRejectedValueOnce(
    new Error("Write timed out"),
  );
  const test = fixture("all");
  await test.user.click(
    await screen.findByRole("button", {
      name: "Delete example-org/project#42",
    }),
  );
  await test.user.click(
    screen.getByRole("button", { name: "Delete submission" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("reload");
  expect(screen.getByRole("table", { hidden: true })).toBeTruthy();
  expect(screen.getByRole("alertdialog")).toBeTruthy();
});

it("does not allow deleting someone else's submission", async () => {
  vi.mocked(loadSubmissions).mockResolvedValue({ rows: [record], warning: "" });
  fixture("all", "other");
  expect(
    (
      (await screen.findByRole("button", {
        name: "Delete example-org/project#42",
      })) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("reload replaces the list so a submission deleted elsewhere disappears", async () => {
  vi.mocked(loadSubmissions)
    .mockResolvedValueOnce({ rows: [record], warning: "" })
    .mockResolvedValue({ rows: [], warning: "" });
  const test = fixture("all");
  await screen.findByRole("table");
  await test.user.click(screen.getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
});

it("guards duplicate deletion and aborts it when leaving the page", async () => {
  vi.mocked(loadSubmissions).mockResolvedValue({ rows: [record], warning: "" });
  let finish = () => {};
  let pending: AbortSignal | undefined;
  vi.mocked(deleteSubmission).mockImplementationOnce(
    async (_s, _c, _row, signal) => {
      pending = signal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  );
  const test = fixture("all");
  await test.user.click(
    await screen.findByRole("button", {
      name: "Delete example-org/project#42",
    }),
  );
  await test.user.click(
    screen.getByRole("button", { name: "Delete submission" }),
  );
  await waitFor(() => expect(deleteSubmission).toHaveBeenCalledTimes(1));
  await test.user.click(
    screen.getByRole("button", { name: "Delete submission" }),
  );
  expect(deleteSubmission).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  test.unmount();
  expect(pending?.aborted).toBe(true);
  await act(async () => finish());
});

it("reminds from a row, guards duplicate clicks and reports success or failure", async () => {
  vi.mocked(loadSubmissions).mockResolvedValue({ rows: [record], warning: "" });
  let finish = () => {};
  vi.mocked(remindSubmission).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const test = fixture("all");
  const button = await screen.findByRole("button", {
    name: "Remind reviewers for example-org/project#42",
  });
  await test.user.click(button);
  expect(screen.getByRole("status").textContent).toContain(
    "Reminding reviewers",
  );
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await test.user.click(button);
  expect(remindSubmission).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByRole("status").textContent).toContain(
    "Reviewers reminded",
  );
  expect(remindSubmission).toHaveBeenCalledWith(
    test.session,
    "channel",
    record,
    expect.any(AbortSignal),
  );
  expect(submitReview).not.toHaveBeenCalled();
  vi.mocked(remindSubmission).mockRejectedValueOnce(
    new Error("Delivery failed"),
  );
  await test.user.click(button);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Delivery failed",
  );
  expect(screen.queryByRole("status")).toBeNull();
});

it("aborts pending reminders when leaving the page", async () => {
  vi.mocked(loadSubmissions).mockResolvedValue({ rows: [record], warning: "" });
  let finish = () => {};
  let pending: AbortSignal | undefined;
  vi.mocked(remindSubmission).mockImplementationOnce(
    async (_s, _c, _r, signal) => {
      pending = signal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  );
  const test = fixture("all");
  await test.user.click(
    await screen.findByRole("button", {
      name: "Remind reviewers for example-org/project#42",
    }),
  );
  test.unmount();
  expect(pending?.aborted).toBe(true);
  await act(async () => finish());
});
