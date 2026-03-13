import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

// Default to Claude Sonnet 4 on Bedrock.
// Override with BEDROCK_LLM_MODEL_ID env var.
const MODEL_ID =
  process.env.BEDROCK_LLM_MODEL_ID ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

export async function complete(systemPrompt: string, userMessage: string): Promise<string> {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
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
