import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

const REQUEST_TIMEOUT_MS = 120_000; // 2 min per request

export const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  requestHandler: { requestTimeout: REQUEST_TIMEOUT_MS },
});

export const LLM_MODEL_ID =
  process.env.BEDROCK_LLM_MODEL_ID ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

export { REQUEST_TIMEOUT_MS };
