import { DbtModel } from '../../core/types';

export function buildGenerationPrompt(model: DbtModel): string {
  const columnList = Object.values(model.columns)
    .map(c => {
      const parts = [`- ${c.name}`];
      if (c.dataType) {parts.push(`(${c.dataType})`);}
      if (c.description) {parts.push(`: ${c.description}`);}
      return parts.join(' ');
    })
    .join('\n');

  return `
You are a dbt expert. Generate a complete semantic model YAML definition for the dbt model below.

Model name: ${model.name}
${model.description ? `Model description: ${model.description}` : ''}
Columns:
${columnList || '(no columns documented)'}

Requirements:
- Identify the most likely primary entity (usually an ID column)
- Identify foreign key entities from columns ending in _id
- Classify dimensions as "time" for date/timestamp columns, "categorical" for everything else
- Suggest measures with appropriate aggregations (count, sum, average, etc.)
- Reference the model using: ref('${model.name}')
- Use snake_case for all names
- Add brief, useful descriptions for each element
- Output only valid YAML — no explanation, no markdown fences

Start your output with: semantic_models:
`.trim();
}
