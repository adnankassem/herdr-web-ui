import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { herdrRpc, tabCreate, tabRename, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";
import { chromePath } from "./chrome-path.ts";

const TAB_LABELS = ["api", "web", "docs", "deploy", "review", "tests", "release-notes", "migrations", "infra", "billing", "search", "mobile", "analytics", "onboarding", "last-tab"];

/**
 * More tabs than fit: the all-tabs chevron appears, lists every tab with the open one marked and a
 * working agent's status, opens the last tab and brings it into view, on a phone (the sheet), an
 * unfolded foldable and a desktop (the popover); a desktop mouse wheel scrolls the strip sideways.
 * A strip whose tabs fit draws no chevron.
 */
export async function checkTabOverflow(browser: Browser, origin: string): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-web-ui-tab-overflow-")));
  let workspaceId: string | null = null;
  let fewId: string | null = null;
  try {
    const created = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-tab-overflow" });
    workspaceId = created.workspace.workspace_id;
    const first = created.root_pane.pane_id;
    await tabRename(created.tab.tab_id, TAB_LABELS[0]!);
    const panes = [first];
    for (const label of TAB_LABELS.slice(1)) panes.push((await tabCreate({ workspaceId, cwd: root, label })).root_pane.pane_id);
    // a working agent in the third tab: the list says so
    await herdrRpc("pane.report_agent", { pane_id: panes[2]!, source: "manual", agent: "claude", state: "working" });
    const few = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-tab-overflow-few" });
    fewId = few.workspace.workspace_id;

    for (const size of [
      { label: "phone", width: 412, height: 915, mobile: true },
      { label: "unfolded", width: 720, height: 870, mobile: true },
      { label: "desktop", width: 1440, height: 900, mobile: false },
    ]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, locale: "en-US" });
      try {
        await context.addInitScript(() => {
          if (localStorage.getItem("herdr-web-ui:settings") === null) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
        });
        const page = await context.newPage();
        await page.goto(`${origin}/?pane=${encodeURIComponent(first)}`);
        const chevron = page.locator(".tab-strip-overflow");
        await chevron.waitFor({ timeout: 15_000 });
        assert.equal((await chevron.textContent())?.trim(), String(TAB_LABELS.length), `${size.label}: the chevron counts the tabs`);
        assert.equal(await chevron.getAttribute("aria-label"), `All tabs (${TAB_LABELS.length})`);
        const last = page.locator('.tab-strip [role="tab"]', { hasText: /^last-tab$/ });
        const tail = await page.locator(".tab-strip-tail").boundingBox();
        const hidden = await last.boundingBox();
        assert.ok(tail && hidden && hidden.x + hidden.width > tail.x + 1, `${size.label}: the last tab starts out of view, under or past the strip's tail`);

        await chevron.click();
        assert.equal(await chevron.getAttribute("aria-expanded"), "true");
        const items = page.locator('[role="menuitem"], .row-sheet-item');
        await items.first().waitFor();
        const labels = (await items.allTextContents()).map((text) => text.trim());
        assert.deepEqual(labels.map((text) => TAB_LABELS.find((name) => text.startsWith(name)) ?? text), TAB_LABELS, `${size.label}: every tab, in strip order`);
        assert.ok(labels[2]?.endsWith("RUN"), `${size.label}: the working tab says RUN (${labels[2]})`);
        const current = items.filter({ hasText: /^api/ }).first();
        assert.equal(await current.getAttribute("aria-current"), "true", `${size.label}: the open tab is marked current`);

        await items.filter({ hasText: /^last-tab/ }).first().click();
        await page.locator('.tab-strip [role="tab"][aria-selected="true"]', { hasText: /^last-tab$/ }).waitFor();
        await page.waitForFunction(() => {
          const active = document.querySelector(".tab-strip-item.is-active")?.getBoundingClientRect();
          const tail = document.querySelector(".tab-strip-tail")?.getBoundingClientRect();
          const row = document.querySelector(".tab-strip")?.getBoundingClientRect();
          return !!active && !!tail && !!row && active.left >= row.left - 1 && active.right <= tail.left + 1;
        }, null, { timeout: 5_000 });
        assert.equal(await items.count(), 0, `${size.label}: the list closes after a pick`);

        if (!size.mobile) {
          const row = page.locator(".tab-strip");
          const before = await row.evaluate((node) => node.scrollLeft);
          await row.hover({ position: { x: 60, y: 10 } });
          await page.mouse.wheel(0, -400);
          await page.waitForFunction((was) => (document.querySelector(".tab-strip")?.scrollLeft ?? was) < was, before, { timeout: 5_000 });
          // a wheel that counts in lines (Firefox's) or pages moves the strip as far as one in pixels would
          for (const [mode, delta, least] of [[1, 3, 30], [2, 1, 200]] as const) {
            const moved = await row.evaluate((node, [deltaMode, deltaY]) => {
              node.scrollLeft = 0;
              node.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode, bubbles: true, cancelable: true }));
              return { moved: node.scrollLeft, room: node.scrollWidth - node.clientWidth };
            }, [mode, delta] as const);
            assert.ok(moved.moved >= Math.min(least, moved.room - 1), `a wheel in ${mode === 1 ? "lines" : "pages"} scrolls the strip (${moved.moved}px of ${moved.room})`);
          }
          // a workspace whose tabs fit has no chevron
          await page.goto(`${origin}/?pane=${encodeURIComponent(few.root_pane.pane_id)}`);
          await page.locator(".tab-strip-add").waitFor();
          assert.equal(await page.locator(".tab-strip-overflow").count(), 0, "a strip whose tabs fit draws no chevron");
        }
      } finally { await context.close(); }
    }
    console.log("PASS an overflowing tab strip lists every tab from its chevron (status, current, pick and scroll into view) on a phone, an unfolded foldable and a desktop, and a mouse wheel scrolls it sideways");
  } finally {
    if (workspaceId) await workspaceClose(workspaceId).catch(() => {});
    if (fewId) await workspaceClose(fewId).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await import("./test-herdr.ts");
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("../server/index.ts");
  const { UsageService } = await import("../server/usage.ts");
  const state = mkdtempSync(join(tmpdir(), "herdr-web-ui-tab-overflow-state-"));
  const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: state, usage: new UsageService(undefined, []) });
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  try {
    await checkTabOverflow(browser, `http://127.0.0.1:${server.port}`);
  } finally {
    await browser.close();
    server.stop();
    rmSync(state, { recursive: true, force: true });
  }
}
