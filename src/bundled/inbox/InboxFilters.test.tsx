// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import {
  InboxFilters,
  InboxViewFilter,
  type ActivityFilter,
  type SenderFilter,
} from "./InboxFilters";

afterEach(cleanup);
function Filters() {
  const [view, setView] = useState<ActivityFilter>("all");
  const [sender, setSender] = useState<SenderFilter>("everyone");
  const [unread, setUnread] = useState(false);
  return (
    <>
      <InboxViewFilter view={view} onViewChange={setView} />
      <InboxFilters
        sender={sender}
        unreadOnly={unread}
        triggerRef={null}
        onSenderChange={setSender}
        onUnreadChange={setUnread}
      />
    </>
  );
}
it("keeps the chosen activity view while sender and unread change independently", async () => {
  const user = userEvent.setup();
  render(<Filters />);
  await user.click(screen.getByRole("tab", { name: "Threads" }));
  await user.click(screen.getByRole("button", { name: "From anyone" }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: "Unread only" }),
  );
  expect(screen.getByRole("tab", { name: "Threads" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "From anyone" }));
  expect(
    await screen.findByRole("menuitemradio", { name: "Unread only" }),
  ).toBeChecked();
  await user.click(
    await screen.findByRole("menuitemradio", { name: "People" }),
  );
  await user.click(screen.getByRole("button", { name: "From people" }));
  expect(
    await screen.findByRole("menuitemradio", { name: "People" }),
  ).toBeChecked();
  expect(
    await screen.findByRole("menuitemradio", { name: "Unread only" }),
  ).toBeChecked();
  await user.click(
    await screen.findByRole("menuitemradio", { name: "All activity" }),
  );
  await user.click(screen.getByRole("button", { name: "From people" }));
  expect(
    await screen.findByRole("menuitemradio", { name: "All activity" }),
  ).toBeChecked();
});
