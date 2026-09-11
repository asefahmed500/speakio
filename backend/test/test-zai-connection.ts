import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function verifyZaiConnection() {
  const apiKey = process.env.ZAI_API_KEY;
  const baseURL = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
  const model = process.env.ZAI_MODEL_FAST || 'glm-4-flash';

  console.log(`\n========================================`);
  console.log(`   Z.AI / GLM Infrastructure Verification`);
  console.log(`========================================`);
  console.log(`Endpoint : ${baseURL}`);
  console.log(`Model    : ${model}`);
  console.log(
    `API Key  : ${apiKey ? apiKey.substring(0, 6) + '...' + apiKey.slice(-4) : 'NOT_SET'}`,
  );

  if (!apiKey || apiKey === 'dummy_key') {
    console.log(`\n[INFO] ZAI_API_KEY is not yet populated in .env.`);
    console.log(
      `When you provide your Z.AI API key, place it in backend/.env:`,
    );
    console.log(`ZAI_API_KEY="your_actual_key_here"`);
    console.log(`========================================\n`);
    return;
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
  });

  try {
    console.log(`\nDispatching handshake test request to Z.AI...`);
    const startTime = Date.now();
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are the Speakio AI Diagnostic Agent. Return valid JSON only: {"status": "connected", "provider": "Z.AI GLM"}',
        },
        { role: 'user', content: 'Ping' },
      ],
      temperature: 0.1,
    });

    const duration = Date.now() - startTime;
    console.log(`\n[SUCCESS] Connected to Z.AI successfully!`);
    console.log(`Latency       : ${duration} ms`);
    console.log(`Model Returned: ${response.model}`);
    console.log(`Tokens Used   : ${response.usage?.total_tokens ?? 0}`);
    console.log(`Payload       : ${response.choices[0]?.message?.content}`);
    console.log(`========================================\n`);
  } catch (error: any) {
    console.error(`\n[ERROR] Failed connecting to Z.AI: ${error.message}`);
  }
}

verifyZaiConnection();
