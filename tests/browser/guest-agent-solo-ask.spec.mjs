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
  await expect(row).toContainText(
    "Viewing only · Answers in your DM or a Solo chat",
  );
  await shot(page, "1-chooser", testInfo);
  await row.click();
  await page.keyboard.type(" are we still on for Thursday?");
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Pollen can’t reply here" });
  await expect(dialog).toContainText(
    "Pollen is viewing only in this channel, so it answers you in your DM.",
  );
  await expect(
    dialog.getByRole("button", { name: "Send here anyway" }),
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

  await panel.getByRole("button", { name: "View channel" }).click();
  await expect(composer).toBeVisible();
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

test("Send here anyway posts in the channel, and an agent outside it still offers a Solo chat", async ({
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
  await expect(dialog).toContainText("Pollen isn’t in this channel.");
  await shot(page, "5-outside-dialog", testInfo);
  await dialog.getByRole("button", { name: "Send here anyway" }).click();
  // Today's flow for people outside the channel takes over from here.
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "6-outside-send-anyway", testInfo);
  expect(errors.unexplained()).toEqual([]);
});
