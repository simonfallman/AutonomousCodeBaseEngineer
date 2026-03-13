import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { TOOL_REGISTRY, TOOL_SCHEMAS } from "./tools.js";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

const MODEL_ID =
  process.env.BEDROCK_LLM_MODEL_ID ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

const SYSTEM_PROMPT = `You are an autonomous software engineering agent. You have access to tools that let you explore a codebase, read and write files, run tests, search semantically, and interact with Git.

When given a task:
1. Explore and understand the relevant code first before making changes.
2. Make targeted, minimal changes.
3. Run tests after changes to verify correctness. If tests fail, fix the issues.
4. Commit your changes with a clear message once tests pass.
5. When you are done, provide a concise summary of what you did.

Be methodical. Use semantic_search to find relevant code quickly. Use read_file to understand context before editing.`;

type Message = {
  role: "user" | "assistant";
  content: unknown;
};

type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type TextBlock = {
  type: "text";
  text: string;
};

type ContentBlock = ToolUseBlock | TextBlock;

type ClaudeResponse = {
  content: ContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
};

async function callClaude(messages: Message[]): Promise<ClaudeResponse> {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: TOOL_SCHEMAS,
    messages,
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body,
  });

  const response = await client.send(command);
  const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  return { content: result.content as ContentBlock[], usage: result.usage };
}

async function callClaudeWithRetry(messages: Message[], maxRetries = 5): Promise<ClaudeResponse> {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callClaude(messages);
    } catch (err: unknown) {
      const name = (err as Record<string, unknown>).name as string | undefined;
      const message = err instanceof Error ? err.message : "";
      const isThrottle =
        name === "ThrottlingException" ||
        message.includes("ThrottlingException") ||
        message.includes("TooManyRequestsException");
      if (!isThrottle || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }
  throw new Error("unreachable");
}

export interface AgentStep {
  type: "tool_call" | "tool_result" | "final_answer";
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  text?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

export async function runAgentLoop(
  task: string,
  maxIterations = 15,
  onProgress?: (message: string) => void
): Promise<{ steps: AgentStep[]; answer: string; usage: AgentUsage }> {
  const messages: Message[] = [{ role: "user", content: task }];
  const steps: AgentStep[] = [];
  let answer = "";
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };

  for (let i = 0; i < maxIterations; i++) {
    onProgress?.(`[${i + 1}/${maxIterations}] Thinking...`);

    const response = await callClaudeWithRetry(messages);
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const textBlocks = response.content.filter((b): b is TextBlock => b.type === "text");

    for (const t of textBlocks) {
      if (t.text.trim()) answer = t.text;
    }

    if (toolUses.length === 0) break;

    const toolResults: unknown[] = [];

    for (const toolUse of toolUses) {
      onProgress?.(`[${i + 1}/${maxIterations}] Calling ${toolUse.name}...`);
      steps.push({ type: "tool_call", tool: toolUse.name, input: toolUse.input });

      let output: string;
      const fn = TOOL_REGISTRY[toolUse.name];
      if (!fn) {
        output = `Error: unknown tool "${toolUse.name}"`;
      } else {
        try {
          output = await fn(toolUse.input);
        } catch (err: unknown) {
          console.error(`[agent] Tool "${toolUse.name}" threw an unhandled error:`, err);
          output = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      steps.push({ type: "tool_result", tool: toolUse.name, output });
      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: output });
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (!answer) answer = "Task completed.";
  steps.push({ type: "final_answer", text: answer });
  onProgress?.("Done.");

  return { steps, answer, usage };
}

export async function planTask(task: string): Promise<string> {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    system:
      "You are a senior software engineer. Given a task description and a list of available tools, produce a concise numbered step-by-step plan to complete the task. Do not execute anything — only plan.",
    messages: [
      {
        role: "user",
        content: `Available tools: ${TOOL_SCHEMAS.map((t) => t.name).join(", ")}\n\nTask: ${task}`,
      },
    ],
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body,
  });

  const response = await client.send(command);
  const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  return result.content[0].text as string;
}
