import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { bedrockClient, LLM_MODEL_ID } from "./client.js";

export async function complete(systemPrompt: string, userMessage: string): Promise<string> {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const command = new InvokeModelCommand({
    modelId: LLM_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body,
  });

  let delay = 1000;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await bedrockClient.send(command);
      const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
      return result.content[0].text as string;
    } catch (err: unknown) {
      const name = (err as Record<string, unknown>).name as string | undefined;
      const message = err instanceof Error ? err.message : "";
      const isThrottle =
        name === "ThrottlingException" ||
        message.includes("ThrottlingException") ||
        message.includes("TooManyRequestsException");
      if (!isThrottle || attempt === maxRetries) throw err;
      console.error(`[llm] Throttled (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15_000);
    }
  }
  throw new Error("unreachable");
}
