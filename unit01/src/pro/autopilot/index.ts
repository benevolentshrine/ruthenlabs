import { getGitHubToken } from '../connect/integrations/github.js';
import { getSlackToken } from '../connect/integrations/slack.js';

export type ModelTier = 'local-fast' | 'local-main' | 'cloud-frontier';

export interface RouteTarget {
  tier: ModelTier;
  modelName: string;
  reason: string;
}

const HIGH_COMPLEXITY_KEYWORDS = [
  'architect', 'design pattern', 'refactor entire', 'database migration',
  'optimize database performance', 'thread synchronization', 'race condition',
  'concurrency issue', 'memory leak debug', 'security audit'
];

const LOW_COMPLEXITY_KEYWORDS = [
  'what is', 'how to run', 'regex for', 'simple script', 'make a folder',
  'list contents', 'create a file named', 'whats the syntax'
];

/**
 * Classifies a user query and returns the appropriate model tier/name.
 */
export function routeTaskModel(promptText: string, activeModelName: string): RouteTarget {
  const normalized = promptText.toLowerCase();

  // 1. Check if user requests a cloud model explicitly (and has a token)
  const hasCloudKeys = getGitHubToken() !== null || getSlackToken() !== null; // Proxy check for API usage credentials

  // 2. High Complexity Routing
  const isHighComplexity = HIGH_COMPLEXITY_KEYWORDS.some(kw => normalized.includes(kw)) || promptText.length > 1500;
  if (isHighComplexity) {
    if (hasCloudKeys) {
      return {
        tier: 'cloud-frontier',
        modelName: 'deepseek-r1', // Default cloud reasoning model fallback
        reason: 'Task classified as high complexity (deep reasoning requested, cloud keys available).'
      };
    }
    // Fall back to main 9B model if no keys are connected
    return {
      tier: 'local-main',
      modelName: activeModelName,
      reason: 'Task classified as high complexity, but no cloud keys are configured. Routing to main local model.'
    };
  }

  // 3. Low Complexity Routing
  const isLowComplexity = LOW_COMPLEXITY_KEYWORDS.some(kw => normalized.includes(kw)) && promptText.length < 250;
  if (isLowComplexity) {
    return {
      tier: 'local-fast',
      modelName: 'qwen2.5-coder:3b', // Lightweight local completion model
      reason: 'Task classified as low complexity (simple lookup/syntax helper).'
    };
  }

  // 4. Default: Route to Main local coder model (7B/9B)
  return {
    tier: 'local-main',
    modelName: activeModelName,
    reason: 'Task classified as standard complexity. Routing to default active model.'
  };
}
