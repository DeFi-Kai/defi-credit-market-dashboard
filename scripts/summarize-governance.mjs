import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getLoadedModel, synthesizeTopic } from '../governance-ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'data', 'governance.json');
const baseUrl = process.env.LM_STUDIO_BASE_URL;
const apiKey = process.env.LM_STUDIO_API_KEY;
const delayMs = Math.max(0, Number(process.env.LM_STUDIO_REQUEST_DELAY_MS || 250));

if (!baseUrl) {
  throw new Error('LM_STUDIO_BASE_URL is required for scheduled governance synthesis.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const data = JSON.parse(await fs.readFile(outputPath, 'utf8'));
const topics = Array.isArray(data.topics) ? data.topics : [];
const needsModel = topics.some((topic) => !topic.ai_model);
const needsSynthesis = topics.some((topic) => !topic.proposal_summary || !topic.signal);
const configuredModel = process.env.LM_STUDIO_MODEL;
const model = topics.length > 0 && (needsModel || needsSynthesis || configuredModel)
  ? (configuredModel || await getLoadedModel(baseUrl, { apiKey }))
  : null;
const pending = topics.filter((topic) => !topic.proposal_summary || !topic.signal || (model && topic.ai_model !== model));

if (pending.length === 0) {
  console.log('No governance posts need AI synthesis.');
} else {
  let completed = 0;

  for (const topic of pending) {
    try {
      const synthesis = await synthesizeTopic(topic, { baseUrl, model, apiKey });
      Object.assign(topic, synthesis, { ai_model: model });
      completed += 1;
      console.log(`[${topic.protocol}] Synthesized ${topic.topic_id}: ${synthesis.signal}`);
    } catch (error) {
      console.warn(`[${topic.protocol}] Could not synthesize ${topic.topic_id}: ${error.message}`);
    }
    await sleep(delayMs);
  }

  console.log(`Synthesized ${completed} of ${pending.length} pending posts.`);
}

await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
