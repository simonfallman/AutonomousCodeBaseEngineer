import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

// Titan Text Embeddings V2 — 1024 dimensions
const MODEL_ID = "amazon.titan-embed-text-v2:0";

export async function embed(text: string): Promise<number[]> {
  const body = JSON.stringify({ inputText: text, dimensions: 1024, normalize: true });
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body,
  });
  const response = await client.send(command);
  const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  return result.embedding as number[];
}
