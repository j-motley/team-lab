import { DbtModel, ContextDocument } from '../../core/types';

const CONTEXT_LABELS: Record<string, string> = {
  architecture: 'Project Architecture',
  naming_conventions: 'Naming Conventions',
  source_index: 'Source Index',
  pattern_library: 'Pattern Library',
  governance_index: 'Governance Index',
  product_catalog: 'Product Catalog',
};

export function buildContextualPrompt(model: DbtModel, contextDocs: ContextDocument[]): string {
  const columnList = Object.values(model.columns)
    .map(c => {
      const parts = [`- ${c.name}`];
      if (c.dataType) {parts.push(`(${c.dataType})`);}
      if (c.description) {parts.push(`: ${c.description}`);}
      return parts.join(' ');
    })
    .join('\n');

  const contextSections = contextDocs
    .map(doc => {
      const label = CONTEXT_LABELS[doc.type] ?? doc.type;
      return `## ${label}\n\n${doc.content}`;
    })
    .join('\n\n---\n\n');

  return `
You are generating a dbt semantic model definition for the model described below.
You have been provided with project-specific context documents. Follow them precisely —
especially naming conventions, patterns, and standards. Do not deviate from team conventions.

${contextSections ? `# Project Context\n\n${contextSections}\n\n---\n\n` : ''}# Model to Generate

Model name: ${model.name}
${model.description ? `Model description: ${model.description}` : ''}
Columns:
${columnList || '(no columns documented)'}

# Requirements

- Follow the naming conventions from the context documents above
- Follow the entity, dimension, and measure patterns from the pattern library above
- Reference the model using: ref('${model.name}')
- Add descriptions consistent with the governance standards above
- Output only valid YAML — no explanation, no markdown fences

Start your output with: semantic_models:
`.trim();
}
