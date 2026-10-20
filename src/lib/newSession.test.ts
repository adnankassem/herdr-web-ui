import { describe, expect, it } from "bun:test";

import { firstMessageOf, newSessionLaunch } from "./newSession.ts";
import { inFlightGuard } from "./sessionHistory.ts";

const plain = { claudeLaunchMode: "default", codexLaunchMode: "default" } as const;

describe("newSessionLaunch", () => {
  it("passes Codex's prompt behind the separator and queues nothing for it", () => {
    const launch = newSessionLaunch({ agent: "codex", model: "", effort: "", prompt: " $review-pr the branch " }, plain);
    expect(launch).toEqual({ agent: { kind: "codex", args: ["--", "$review-pr the branch"] }, prompt: { text: "$review-pr the branch", via: "positional" } });
    expect(firstMessageOf(launch)).toBeNull();
  });

  it("starts Claude Code and every other agent without the prompt, and queues it as the request's first message", () => {
    const claude = newSessionLaunch({ agent: "claude", model: "opus", effort: "high", prompt: "Fix it" }, { ...plain, claudeLaunchMode: "plan" });
    expect(claude).toEqual({ agent: { kind: "claude", args: ["--permission-mode", "plan", "--model", "opus", "--effort", "high"] }, prompt: { text: "Fix it", via: "pending" } });
    expect(firstMessageOf(claude)).toBe("Fix it");
    const omp = newSessionLaunch({ agent: "omp", model: "", effort: "", prompt: "Plan the config file" }, plain);
    expect(omp).toEqual({ agent: { kind: "omp" }, prompt: { text: "Plan the config file", via: "pending" } });
    expect(firstMessageOf(omp)).toBe("Plan the config file");
    expect(newSessionLaunch({ agent: "omp", model: "", effort: "", prompt: "  " }, plain)).toEqual({ agent: { kind: "omp" }, prompt: null });
    expect(newSessionLaunch({ agent: "", model: "", effort: "", prompt: "" }, plain)).toEqual({ agent: null, prompt: null });
  });

  it("names the first choice an agent's launch does not take, and queues nothing for it", () => {
    expect(newSessionLaunch({ agent: "omp", model: "gpt-5", effort: "", prompt: "" }, plain)).toEqual({ fault: "model" });
    expect(newSessionLaunch({ agent: "omp", model: "", effort: "high", prompt: "" }, plain)).toEqual({ fault: "effort" });
    expect(newSessionLaunch({ agent: "codex", model: "", effort: "ultracode", prompt: "" }, plain)).toEqual({ fault: "effort" });
    expect(newSessionLaunch({ agent: "", model: "", effort: "", prompt: "a shell runs no agent" }, plain)).toEqual({ fault: "prompt" });
    expect(firstMessageOf({ fault: "prompt" })).toBeNull();
  });
});

describe("Start's in-flight guard", () => {
  it("sends one create however often Start is pressed while the first is in flight, then takes the next", async () => {
    const guard = inFlightGuard();
    const sent: unknown[] = [];
    let release = (): void => {};
    const create = (body: unknown) => {
      sent.push(body);
      return new Promise<{ pane_id: string }>((resolve) => { release = () => resolve({ pane_id: `p${sent.length}` }); });
    };
    const launch = newSessionLaunch({ agent: "omp", model: "", effort: "", prompt: "Fix it" }, plain);
    const start = () => guard.run(() => create({ workspace_id: "w1", agent: "fault" in launch ? null : launch.agent, first_message: firstMessageOf(launch) }));
    const first = start();
    expect(first).not.toBeNull();
    expect(start()).toBeNull();
    expect(start()).toBeNull();
    expect(guard.busy()).toBeTrue();
    release();
    await expect(first).resolves.toEqual({ pane_id: "p1" });
    expect(sent).toEqual([{ workspace_id: "w1", agent: { kind: "omp" }, first_message: "Fix it" }]);
    expect(guard.busy()).toBeFalse();
    expect(start()).not.toBeNull();
    expect(sent).toHaveLength(2);
  });
});
