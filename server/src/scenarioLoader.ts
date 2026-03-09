import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Scenario, ScenarioVariant } from '@honkai-chat/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const variantFileMap: Record<ScenarioVariant, string> = {
  'default': 'penaconia.json',
  'no-sunday': 'penaconia-no-sunday.json',
  'no-firefly': 'penaconia-no-firefly.json',
  'no-robin': 'penaconia-no-robin.json',
};

export function loadScenario(variant: ScenarioVariant = 'default'): Scenario {
  const filename = variantFileMap[variant];
  const scenarioPath = join(__dirname, 'scenario', filename);
  const raw = readFileSync(scenarioPath, 'utf-8');
  return JSON.parse(raw) as Scenario;
}
