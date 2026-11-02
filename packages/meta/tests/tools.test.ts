import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { runTools } from "../src/models.ts";

/** A scripted OpenAI-compatible client: answers with the queued messages and records what it was sent. */
function client(replies: object[]) {
  const sent: { messages: unknown[]; tools?: unknown }[] = [];
  const c = { chat: { completions: { create: async (req: { messages: unknown[]; tools?: unknown }) => { sent.push(structuredClone(req)); return { choices: [{ message: replies.shift() }], usage: {} }; } } } };
  return { c: c as unknown as OpenAI, sent };
}
const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

describe("runTools", () => {
  it("runs parallel tool calls, feeds results back, and returns the final answer", async () => {
    const { c, sent } = client([
      { role: "assistant", content: "Checking two sites.", tool_calls: [call("a", "read", { url: "x.com" }), call("b", "read", { url: "y.com" })] },
      { role: "assistant", content: "Both lead with discounts." },
    ]);
    const seen: string[] = [], texts: string[] = [];
    const out = await runTools({ client: c, model: "m", system: "s", text: "t", maxSteps: 4, onText: (t) => void texts.push(t),
      tools: [{ name: "read", description: "", parameters: {}, run: async (a) => { seen.push(String(a.url)); return `read ${a.url}`; } }] });
    expect(out).toBe("Both lead with discounts.");
    expect(seen.sort()).toEqual(["x.com", "y.com"]);
    expect(texts).toEqual(["Checking two sites.", "Both lead with discounts."]);
    const second = sent[1]!.messages as { role: string; tool_call_id?: string; content?: string }[];
    expect(second.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m.content])).toEqual([["a", "read x.com"], ["b", "read y.com"]]);
  });

  it("turns a failing or unknown tool into an error the model can read, and wraps up when out of steps", async () => {
    const { c, sent } = client([
      { role: "assistant", content: "", tool_calls: [call("a", "read", {}), call("b", "nope", {})] },
      { role: "assistant", content: "Summary." },
    ]);
    const out = await runTools({ client: c, model: "m", system: "s", text: "t", maxSteps: 1,
      tools: [{ name: "read", description: "", parameters: {}, run: async () => { throw new Error("blocked"); } }] });
    expect(out).toBe("Summary.");
    const last = sent[1]!;
    expect(last.tools).toBeUndefined();
    const tools = (last.messages as { role: string; content?: string }[]).filter((m) => m.role === "tool").map((m) => m.content);
    expect(tools).toEqual(["error: blocked", "error: there is no tool called nope"]);
  });
});
