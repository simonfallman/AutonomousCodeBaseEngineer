import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

const REQUEST_TIMEOUT_MS = 120_000; // 2 min per request

export const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  requestHandler: { requestTimeout: REQUEST_TIMEOUT_MS },
});

// Validate model ID format at import time so misconfigurations surface immediately.
const rawModelId = process.env.BEDROCK_LLM_MODEL_ID ?? "us.anthropic.claude-sonnet-4-20250514-v1:0";

// Bedrock model IDs follow patterns like:
//   anthropic.claude-3-sonnet-...
//   us.anthropic.claude-sonnet-4-...
//   arn:aws:bedrock:...
const VALID_MODEL_ID_RE = /^(arn:aws:bedrock:|[a-z]{2}\.)?anthropic\.claude-/;

if (!VALID_MODEL_ID_RE.test(rawModelId)) {
  console.error(
    `[llm] WARNING: BEDROCK_LLM_MODEL_ID "${rawModelId}" does not match expected Anthropic model ID pattern. ` +
    `This will likely cause "The provided model identifier is invalid" errors. ` +
    `Expected format: us.anthropic.claude-sonnet-4-5-YYYYMMDD-v1:0`
  );
}

export const LLM_MODEL_ID = rawModelId;

console.error(`[llm] Using model: ${LLM_MODEL_ID}`);

export { REQUEST_TIMEOUT_MS };
