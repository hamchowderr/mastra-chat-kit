import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, startFromConfig } from '@copilotkit/aimock';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'aimock.json');

/**
 * Vitest globalSetup: boot AIMock from aimock.json with the chat fixtures, then
 * return a teardown that stops it. Runs once per `vitest run`.
 */
export default async function () {
  const config = loadConfig(CONFIG_PATH);
  if (config.llm?.fixtures && !path.isAbsolute(config.llm.fixtures)) {
    config.llm.fixtures = path.resolve(path.dirname(CONFIG_PATH), config.llm.fixtures);
  }
  const { llmock } = await startFromConfig(config);
  return async () => {
    await llmock.stop();
  };
}
