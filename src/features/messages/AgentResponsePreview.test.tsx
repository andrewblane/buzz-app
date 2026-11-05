// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { stubAvatarBrowserApis } from "../agents/avatar-testing";
import type { RelaySession } from "../relay/session";
import { AgentResponsePreview } from "./AgentResponsePreview";
import { fixture } from "./typing-indicator-testing";

stubAvatarBrowserApis();
afterEach(cleanup);

type Agent = { id: string; name: string };
const agent = (digit: string): Agent => ({
  id: digit.repeat(64),
  name: `Agent ${digit}`,
});
// Ordered by key, as working rows order their agents.
const first = agent("0"),
  second = agent("1"),
  third = agent("2"),
  fourth = agent("3");

function row(
  session: RelaySession,
  [named, ...others]: readonly [Agent, ...Agent[]],
) {
  return (
    <AgentResponsePreview
      name={named.name}
      participants={[named, ...others]}
      profile={{
        pubkey: named.id,
        session,
        channelId: "channel",
        canOpen: () => true,
        open: () => true,
      }}
    >
      <button type="button">Activity</button>
    </AgentResponsePreview>
  );
}

it("keeps a focused avatar shown while agents ahead of it fill the group", () => {
  const { session } = fixture();
  const view = render(row(session, [fourth]));
  const avatar = screen.getByRole("button", { name: "View Agent 3 profile" });
  act(() => avatar.focus());
  view.rerender(row(session, [second, third, fourth]));
  view.rerender(row(session, [first, second, third, fourth]));
  expect(avatar).toHaveFocus();
  // It takes the third place from the agent it sorts after.
  expect(screen.getByTitle("Agent 0")).toBeVisible();
  expect(screen.getByTitle("Agent 1")).toBeVisible();
  expect(screen.queryByTitle("Agent 2")).toBeNull();
});

it.each([
  ["the remaining agent's avatar", [second], "View Agent 1 profile"],
  ["the bubble's control", [second, third], "Activity"],
] as const)(
  "hands a focused avatar whose agent stops to %s",
  (_, remaining, successor) => {
    const { session } = fixture();
    const view = render(row(session, [first]));
    const avatar = screen.getByRole("button", { name: "View Agent 0 profile" });
    act(() => avatar.focus());
    view.rerender(row(session, [first, ...remaining]));
    expect(avatar).toHaveFocus();
    view.rerender(row(session, remaining));
    expect(avatar.isConnected).toBe(false);
    expect(screen.getByRole("button", { name: successor })).toHaveFocus();
  },
);
