import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const REQUEST_TIMEOUT_MS = 30_000; // 30s per embedding call

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  requestHandler: { requestTimeout: REQUEST_TIMEOUT_MS },
});

// Titan Text Embeddings V2 — 1024 dimensions
const MODEL_ID = "amazon.titan-embed-text-v2:0";

export async function embed(text: string): Promise<number[]> {
  // Titan has a max input of ~8k tokens — truncate very long chunks
  const truncated = text.length > 20_000 ? text.slice(0, 20_000) : text;
  const body = JSON.stringify({ inputText: truncated, dimensions: 1024, normalize: true });
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body,
  });

  let delay = 500;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.send(command);
      const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
      return result.embedding as number[];
    } catch (err: unknown) {
      const name = (err as Record<string, unknown>).name as string | undefined;
      const message = err instanceof Error ? err.message : "";
      const isThrottle =
        name === "ThrottlingException" ||
        message.includes("ThrottlingException") ||
        message.includes("TooManyRequestsException");
      if (!isThrottle || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10_000);
    }
  }
  throw new Error("unreachable");
}
