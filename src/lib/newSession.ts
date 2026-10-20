/**
 * What the new workspace and tab dialogs start (#774, #1311): the agent of the create request for
 * the dialog's fields, with its launch arguments (lib/agentLaunchMode.ts), and where the first
 * message goes. Codex takes it as its own positional argument behind the end-of-options separator;
 * any other agent gets it as the request's `first_message`, which the bridge queues for the agent's
 * first ready turn through its pending path (server/core/pending.ts). Either way the request is the
 * one send: nothing is typed by this page afterwards.
 */
import type { ClaudeLaunchMode, CodexLaunchMode } from "./agentLaunchMode.ts";
import { firstPromptDelivery, launchAgent, launchChoiceFault } from "./agentLaunchMode.ts";

export interface NewSessionFields {
  /** the agent kind; "" is a plain shell */
  agent: string;
  model: string;
  effort: string;
  prompt: string;
}

export type FirstPrompt = { text: string; via: "positional" | "pending" };

export type NewSessionLaunch =
  | { agent: { kind: string; args?: string[] } | null; prompt: FirstPrompt | null }
  | { fault: "model" | "effort" | "prompt" };

/** The create request's agent for the fields, or the first choice the launch does not take. */
export function newSessionLaunch(fields: NewSessionFields, modes: { claudeLaunchMode: ClaudeLaunchMode; codexLaunchMode: CodexLaunchMode }): NewSessionLaunch {
  const fault = launchChoiceFault(fields.agent, fields);
  if (fault !== null) return { fault };
  const via = firstPromptDelivery(fields.agent, fields.prompt);
  const text = fields.prompt.trim();
  return {
    agent: launchAgent(fields.agent, modes, { model: fields.model, effort: fields.effort, prompt: via === "positional" ? text : "" }),
    prompt: via === null ? null : { text, via },
  };
}

/** The request's `first_message`: the prompt the bridge queues, or null when there is none or the agent takes it itself. */
export function firstMessageOf(launch: NewSessionLaunch): string | null {
  return "fault" in launch || launch.prompt?.via !== "pending" ? null : launch.prompt.text;
}
