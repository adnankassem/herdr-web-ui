/**
 * The phone's terminal input line and key bar are evenly spaced: the field and the send button have
 * the same room below them as above (they never sit on the key bar's rule), and the keys sit in the
 * middle of the key bar with room above and below (never against the screen's edge), each still a
 * 44px touch target inside the bar. Folded (412) and unfolded (720) widths, a gesture-bar inset,
 * the on-screen keyboard up (visualViewport) and a landscape phone. On the isolated test herdr;
 * UI_EVIDENCE_DIR=<dir> keeps the screenshots.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { workspaceClose, workspaceCreate } from "../server/herdr/client.ts";
import { chromePath } from "./chrome-path.ts";

type KeyboardQA = Window & { keyboardQA: (height: number | null) => void };

export async function checkTerminalInputSpacing(browser: Browser, origin: string, evidence?: string): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-web-ui-input-spacing-")));
  let workspaceId: string | null = null;
  try {
    const created = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-input-spacing" });
    workspaceId = created.workspace.workspace_id;
    for (const size of [
      { label: "folded 412x915", width: 412, height: 915, inset: 0, keyboard: 0 },
      { label: "gesture bar 412x915", width: 412, height: 915, inset: 24, keyboard: 0 },
      { label: "keyboard up 412x915", width: 412, height: 915, inset: 0, keyboard: 420 },
      { label: "unfolded 720x870", width: 720, height: 870, inset: 0, keyboard: 0 },
      { label: "landscape 915x412", width: 915, height: 412, inset: 16, keyboard: 0 },
    ]) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "en-US" });
      try {
        await context.addInitScript(() => {
          localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", terminalInputMode: "line" }));
          const viewport = window.visualViewport!;
          let height: number | null = null;
          Object.defineProperty(viewport, "height", { get: () => height ?? window.innerHeight });
          (window as unknown as KeyboardQA).keyboardQA = (value) => { height = value; viewport.dispatchEvent(new Event("resize")); };
        });
        const page = await context.newPage();
        if (size.inset > 0) {
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setSafeAreaInsetsOverride" as never, { insets: { top: 0, topMax: 0, left: 0, leftMax: 0, bottom: size.inset, bottomMax: size.inset, right: 0, rightMax: 0 } } as never);
        }
        await page.goto(`${origin}/?pane=${encodeURIComponent(created.root_pane.pane_id)}`);
        await page.locator(".terminal-input").waitFor();
        if (size.keyboard > 0) {
          await page.locator(".terminal-input-text").focus();
          await page.evaluate((height) => (window as unknown as KeyboardQA).keyboardQA(height), size.height - size.keyboard);
          await page.waitForFunction((bottom) => (document.querySelector(".key-bar")?.getBoundingClientRect().bottom ?? 0) <= bottom + 1, size.height - size.keyboard);
        }
        const geometry = await page.evaluate(() => {
          const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          const line = box(".terminal-input");
          const keyBar = document.querySelector(".key-bar")!;
          const bar = keyBar.getBoundingClientRect();
          const barPadding = parseFloat(getComputedStyle(keyBar).paddingBottom);
          const keys = [...keyBar.querySelectorAll<HTMLElement>(".key")].map((key) => {
            const own = key.getBoundingClientRect();
            const grow = -parseFloat(getComputedStyle(key, "::before").top) || 0;
            return { top: own.top, bottom: own.bottom, tapTop: own.top - grow, tapBottom: own.bottom + grow };
          });
          return {
            line: { top: line.top + 1, bottom: line.bottom }, text: box(".terminal-input-text"), send: box(".terminal-input-send"),
            bar: { top: bar.top, bottom: bar.bottom - barPadding }, keys, barPadding, screenBottom: window.visualViewport!.height,
          };
        });
        // the home indicator's room is the bar's own padding (KeyBar.css: the safe area less --space-2),
        // checked before the spacing below measures the bar without it: a bar that lost it would put
        // its keys at the screen's edge and still look evenly spaced
        assert.ok(Math.abs(geometry.barPadding - Math.max(0, size.inset - 8)) <= 0.5, `${size.label}: the key bar keeps the gesture bar's room (${geometry.barPadding}px for a ${size.inset}px inset)`);
        if (size.keyboard === 0) {
          const clear = geometry.screenBottom - Math.max(...geometry.keys.map((key) => key.bottom));
          assert.ok(clear >= Math.max(4, size.inset - 8), `${size.label}: the keys stand ${clear}px clear of the screen's bottom edge`);
        }
        for (const [name, control] of [["field", geometry.text], ["send button", geometry.send]] as const) {
          const above = control.top - geometry.line.top;
          const below = geometry.line.bottom - control.bottom;
          assert.ok(below >= 3.5 && Math.abs(above - below) <= 1.5, `${size.label}: the ${name} has as much room below as above (${above} / ${below})`);
        }
        assert.ok(geometry.keys.length > 0, `${size.label}: the key bar shows keys`);
        for (const key of geometry.keys) {
          const above = key.top - geometry.bar.top;
          const below = geometry.bar.bottom - key.bottom;
          assert.ok(above >= 4 && below >= 4 && Math.abs(above - below) <= 1.5, `${size.label}: a key sits in the middle of the bar (${above} / ${below})`);
          assert.ok(key.tapBottom - key.tapTop >= 43.5, `${size.label}: a key keeps a 44px touch target (${key.tapBottom - key.tapTop})`);
          assert.ok(key.tapTop >= geometry.bar.top - 0.5, `${size.label}: a key's touch target stays inside the bar`);
        }
        if (evidence) await page.screenshot({ path: join(evidence, `input-spacing-${size.label.replace(/\s+/g, "-")}.png`) });
      } finally { await context.close(); }
    }
    console.log("PASS the phone's terminal input line and key bar are evenly spaced (field and send button, keys with 44px targets) folded, unfolded, over a gesture bar, with the keyboard up and in landscape");
  } finally {
    if (workspaceId) await workspaceClose(workspaceId).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await import("./test-herdr.ts");
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("../server/index.ts");
  const { UsageService } = await import("../server/usage.ts");
  const state = mkdtempSync(join(tmpdir(), "herdr-web-ui-input-spacing-state-"));
  const evidence = process.env["UI_EVIDENCE_DIR"];
  if (evidence) mkdirSync(evidence, { recursive: true });
  const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: state, usage: new UsageService(undefined, []) });
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  try {
    await checkTerminalInputSpacing(browser, `http://127.0.0.1:${server.port}`, evidence);
  } finally {
    await browser.close();
    server.stop();
    rmSync(state, { recursive: true, force: true });
  }
}
