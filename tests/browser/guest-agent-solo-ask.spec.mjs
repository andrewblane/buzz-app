import { test, expect } from "./source-fixture.mjs";
import { watchPageErrors } from "./page-errors.mjs";

// Real browser walk for an agent that can't reply in a channel: the viewer's own
// agent is a Guest (Viewing only) in a private channel. The chooser says so, a
// send addressed only to it offers a Solo chat, and the Solo chat links back.
// Set GUEST_ASK_SHOTS to a directory to keep demo screenshots.
const shots = process.env.GUEST_ASK_SHOTS;
async function shot(page, name, { project }) {
  if (!shots || project.name !== "chromium") return;
  // Dialogs and the side panel animate in; capture them settled.
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    ),
  );
  await page.screenshot({ path: `${shots}/${name}.png` });
}

async function mention(page, composer, text) {
  await composer.click();
  await page.keyboard.type("@Poll");
  const row = page.getByRole("option", { name: /^Pollen / });
  await expect(row).toContainText(
    "Viewing only · Answers in your DM or a Solo chat",
  );
  return row.click().then(() => page.keyboard.type(` ${text}`));
}

test("a Viewing-only agent is asked in a Solo chat that links back to the channel", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/fixtures/bestie-catch-up.html?guest");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: /Message #?launch/i });
  await composer.click();
  await page.keyboard.type("@Poll");
  const row = page.getByRole("option", { name: /^Pollen / });
  // Pollen is the viewer's Bestie, named ahead of the unchanged detail.
  await expect(row).toContainText(
    "Bestie · Viewing only · Answers in your DM or a Solo chat",
  );
  await shot(page, "1-chooser", testInfo);
  await row.click();
  await page.keyboard.type(" are we still on for Thursday?");
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Pollen can’t reply here" });
  await expect(dialog).toContainText(
    "Pollen is viewing only in #launch. Make it a member so it can reply here, or ask it in a Solo chat.",
  );
  await expect(
    dialog.getByRole("button", { name: "Send here anyway" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Make member and send" }),
  ).toBeVisible();
  await shot(page, "2-dialog", testInfo);
  await dialog.getByRole("button", { name: "Ask in a Solo chat" }).click();
  await expect(dialog).toBeHidden();

  // The draft moved to the Solo chat; nothing was posted in the channel.
  await expect(composer).toHaveText("");
  await expect(
    page
      .getByRole("tabpanel", { name: "launch" })
      .filter({ hasText: "are we still on for Thursday?" }),
  ).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Bestie catch-up" });
  await expect(panel).toContainText("Asked from #launch");
  await expect(panel).toContainText(
    /are we still on for Thursday\?\s*\(Asked from #launch, where you can’t reply\.\)/,
  );
  await page.getByRole("button", { name: "Deliver fixture response" }).click();
  await expect(panel).toContainText("I can’t post in #launch");
  await shot(page, "3-solo-chat", testInfo);
  // While open, a top-bar launcher (Current panel) names the asked agent.
  await expect(page.locator("[data-catch-up-launcher]")).toHaveAccessibleName(
    "Hide Solo chat with Pollen",
  );

  await panel.getByRole("button", { name: "View channel" }).click();
  await expect(composer).toBeVisible();
  // Closed, the sent ask leaves nothing in the top bar; its Solo chat stays
  // under Solo in the sidebar.
  await panel.getByRole("button", { name: "Hide Bestie catch-up" }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator("[data-catch-up-launcher]")).toHaveCount(0);
  await shot(page, "14-top-nav-after-close", testInfo);
  expect(errors.unexplained()).toEqual([]);
});

test("a thread reply asks in a Solo chat that links back to the thread", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/fixtures/bestie-catch-up.html?guest");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  const root = page
    .locator("[data-message-id]")
    .filter({ hasText: "Should we launch on Thursday?" })
    .first();
  await root.getByRole("button", { name: /1 reply/ }).click();
  const thread = page.getByRole("textbox", { name: /Reply/i });
  await mention(page, thread, "can you summarize this thread?");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Pollen can’t reply here" });
  await dialog.getByRole("button", { name: "Ask in a Solo chat" }).click();
  const panel = page.getByRole("region", { name: "Bestie catch-up" });
  await expect(panel).toContainText("Asked from a thread in #launch");
  await expect(panel).toContainText(
    /\(Asked from a thread you can’t reply in: You in #launch\)/,
  );
  await shot(page, "4-thread-solo-chat", testInfo);
  await expect(
    panel.getByRole("button", { name: "View thread" }),
  ).toBeVisible();
  expect(errors.unexplained()).toEqual([]);
});

test("Send here anyway posts in the channel, and an agent outside it asks only once", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/fixtures/bestie-catch-up.html?guest");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: "Message #launch" });
  await mention(page, composer, "post this here please");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Pollen can’t reply here" });
  await dialog.getByRole("button", { name: "Send here anyway" }).click();
  await expect(
    page
      .getByRole("tabpanel", { name: "launch" })
      .locator("[data-message-id]")
      .filter({ hasText: "post this here please" }),
  ).toHaveCount(1);
  await expect(composer).not.toContainText("post this here please");

  await page.goto("/tests/fixtures/bestie-catch-up.html?guest=outside");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  await composer.click();
  await page.keyboard.type("@Poll");
  const row = page.getByRole("option", { name: /^Pollen / });
  await expect(row).toContainText("Not in channel");
  await row.click();
  await page.keyboard.type(" are you around?");
  await page.keyboard.press("Enter");
  await expect(dialog).toContainText(
    "Pollen isn’t in #launch. Add it to the channel so it can reply here, or ask it in a Solo chat.",
  );
  await shot(page, "5-outside-dialog", testInfo);
  await dialog.getByRole("button", { name: "Send here anyway" }).click();
  // This dialog already asked; the outside-people prompt doesn't follow it.
  await expect(
    page
      .getByRole("tabpanel", { name: "launch" })
      .locator("[data-message-id]")
      .filter({ hasText: "are you around?" }),
  ).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await shot(page, "6-outside-send-anyway", testInfo);
  expect(errors.unexplained()).toEqual([]);
});

test("Make member and send lets a Viewing-only agent reply in the channel", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/fixtures/bestie-catch-up.html?guest");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: "Message #launch" });
  await mention(page, composer, "are we still on for Thursday?");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Pollen can’t reply here" });
  await shot(page, "8-make-member-dialog", testInfo);
  await dialog.getByRole("button", { name: "Make member and send" }).click();
  await expect(dialog).toBeHidden();
  // The role change is confirmed first, then the draft posts here, notifying
  // Pollen, with no other prompt.
  const sent = page
    .getByRole("tabpanel", { name: "launch" })
    .locator("[data-message-id]")
    .filter({ hasText: "are we still on for Thursday?" });
  await expect(sent).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(composer).not.toContainText("are we still on for Thursday?");
  // The chooser follows the new role on its own.
  await composer.click();
  await page.keyboard.type("@Poll");
  const row = page.getByRole("option", { name: /^Pollen / });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Viewing only");
  await shot(page, "9-member-chooser", testInfo);
  await row.click();
  await page.keyboard.type(" thanks!");
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("tabpanel", { name: "launch" })
      .locator("[data-message-id]")
      .filter({ hasText: "thanks!" }),
  ).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors.unexplained()).toEqual([]);
});

test("Add to channel and send adds an outside agent with one prompt", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/fixtures/bestie-catch-up.html?guest=outside");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: "Message #launch" });
  await composer.click();
  await page.keyboard.type("@Poll");
  const row = page.getByRole("option", { name: /^Pollen / });
  await expect(row).toContainText("Not in channel");
  await row.click();
  await page.keyboard.type(" are you around?");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Pollen can’t reply here" });
  await dialog.getByRole("button", { name: "Add to channel and send" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole("tabpanel", { name: "launch" })
      .locator("[data-message-id]")
      .filter({ hasText: "are you around?" }),
  ).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await composer.click();
  await page.keyboard.type("@Poll");
  await expect(
    page.getByRole("option", { name: /^Pollen / }),
  ).not.toContainText("Not in channel");
  await shot(page, "10-added-chooser", testInfo);
  expect(errors.unexplained()).toEqual([]);
});

test("a refused role change keeps the draft and says why", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/fixtures/bestie-catch-up.html?guest&refuse");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: "Message #launch" });
  await mention(page, composer, "are we still on for Thursday?");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Pollen can’t reply here" });
  await dialog.getByRole("button", { name: "Make member and send" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Only channel owners and admins can change roles. Your draft is kept.",
  );
  await shot(page, "11-refused", testInfo);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(composer).toContainText("are we still on for Thursday?");
  await expect(
    page
      .getByRole("tabpanel", { name: "launch" })
      .locator("[data-message-id]")
      .filter({ hasText: "are we still on for Thursday?" }),
  ).toHaveCount(0);
  expect(errors.unexplained()).toEqual([]);
});

test("someone else's Viewing-only agent sends as before, with no dialog", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/fixtures/bestie-catch-up.html?guest=other");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: "Message #launch" });
  await composer.click();
  await page.keyboard.type("@Poll");
  const row = page.getByRole("option", { name: /^Pollen / });
  await expect(row).toContainText("Viewing only · Can’t reply here");
  await expect(row).not.toContainText("Bestie");
  await shot(page, "12-other-chooser", testInfo);
  await row.click();
  await page.keyboard.type(" can you take a look?");
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("tabpanel", { name: "launch" })
      .locator("[data-message-id]")
      .filter({ hasText: "can you take a look?" }),
  ).toHaveCount(1);
  // Its owner decides whether it joins; the viewer isn't asked.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await shot(page, "13-other-sent", testInfo);
  expect(errors.unexplained()).toEqual([]);
});

test("a cold start labels the Viewing-only agent once the relay confirms membership", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // As on app launch: Launch opens from saved membership before the relay
  // confirms it, and roles can't be read until then.
  await page.goto("/tests/fixtures/bestie-catch-up.html?guest=cold");
  await page
    .getByRole("button", { name: "Launch channel", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: "Message #launch" });
  await expect(composer).toBeVisible();
  await page.getByRole("button", { name: "Confirm membership" }).click();
  // No members panel: the first mention already knows Pollen is Viewing only.
  await composer.click();
  await page.keyboard.type("@Poll");
  const row = page.getByRole("option", { name: /^Pollen / });
  await expect(row).toContainText(
    "Viewing only · Answers in your DM or a Solo chat",
  );
  await shot(page, "7-cold-start-chooser", testInfo);
  await row.click();
  await page.keyboard.type(" are we still on for Thursday?");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Pollen can’t reply here" }),
  ).toBeVisible();
  expect(errors.unexplained()).toEqual([]);
});
