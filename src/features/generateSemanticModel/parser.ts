import * as yaml from 'js-yaml';

export interface ParseResult {
  yaml: string;
  valid: boolean;
  error?: string;
}

export function parseAiOutput(raw: string): ParseResult {
  // Strip markdown fences if the model wrapped the output despite instructions
  const fenceMatch = raw.match(/```ya?ml\n([\s\S]*?)```/);
  const content = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  // Must start with the expected key
  if (!content.startsWith('semantic_models:')) {
    return {
      yaml: content,
      valid: false,
      error: 'Output did not start with "semantic_models:". The AI may have returned an explanation instead of YAML.',
    };
  }

  try {
    yaml.load(content);
    return { yaml: content, valid: true };
  } catch (err) {
    return {
      yaml: content,
      valid: false,
      error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
