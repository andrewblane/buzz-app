// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LinkSettings } from "./LinkSettings";
import { setShowGitHubCards, showGitHubCards } from "./card-preference";

const toggle = () => screen.getByRole("switch", { name: "Show GitHub cards" });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("defaults to cards and saves both choices independently of link opening", async () => {
  const user = userEvent.setup();
  const view = render(<LinkSettings active={() => true} />);
  expect(toggle()).toBeChecked();
  await user.click(toggle());
  expect(toggle()).not.toBeChecked();
  expect(showGitHubCards()).toBe(false);
  expect(
    screen.getByRole("switch", { name: "Open GitHub links in Buzz" }),
  ).toBeChecked();
  view.unmount();
  render(<LinkSettings active={() => true} />);
  expect(toggle()).not.toBeChecked();
  toggle().focus();
  await user.keyboard(" ");
  expect(toggle()).toBeChecked();
  expect(showGitHubCards()).toBe(true);
});

it("tracks another window and storage clear", () => {
  render(<LinkSettings active={() => true} />);
  act(() => setShowGitHubCards(false));
  expect(toggle()).not.toBeChecked();
  const key = localStorage.key(0);
  if (!key) throw new Error("Preference was not saved");
  act(() => {
    localStorage.setItem(key, "on");
    window.dispatchEvent(
      new StorageEvent("storage", { key, storageArea: localStorage }),
    );
  });
  expect(toggle()).toBeChecked();
  act(() => setShowGitHubCards(false));
  act(() => {
    localStorage.clear();
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, storageArea: localStorage }),
    );
  });
  expect(toggle()).toBeChecked();
});

it("reports failed saves without changing the choice and supports retry", async () => {
  render(<LinkSettings active={() => true} />);
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
  await userEvent.click(toggle());
  expect(toggle()).toBeChecked();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your choice could not be saved",
  );
  write.mockRestore();
  await userEvent.click(toggle());
  expect(toggle()).not.toBeChecked();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not save an inactive contribution", async () => {
  render(<LinkSettings active={() => false} />);
  await userEvent.click(toggle());
  expect(toggle()).toBeChecked();
  expect(localStorage.length).toBe(0);
});

it("keeps the default for unreadable or unknown stored values", () => {
  setShowGitHubCards(false);
  const key = localStorage.key(0);
  if (!key) throw new Error("Preference was not saved");
  localStorage.setItem(key, "invalid");
  expect(showGitHubCards()).toBe(true);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  expect(showGitHubCards()).toBe(true);
});
