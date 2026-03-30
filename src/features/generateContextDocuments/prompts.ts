import { DbtProjectInfo, DbtModel, SemanticModel } from '../../core/types';

export function buildArchitecturePrompt(
  projectInfo: DbtProjectInfo,
  models: DbtModel[],
  semanticModels: SemanticModel[]
): string {
  const modelPaths = [...new Set(models.map(m => m.path.split('/').slice(-3, -1).join('/')))];

  return `
You are a dbt architecture expert. Analyze the following dbt project metadata and produce a concise
architecture reference document in markdown.

Project name: ${projectInfo.name}
dbt version requirement: ${JSON.stringify(projectInfo.requireDbtVersion) ?? 'not specified'}
Model paths: ${projectInfo.modelPaths.join(', ')}
Total models: ${models.length}
Total semantic models: ${semanticModels.length}
Model folders observed: ${modelPaths.slice(0, 20).join(', ')}

Produce a markdown document covering:
1. Project overview and purpose
2. Folder structure and layer responsibilities
3. Data flow between layers
4. Key architectural patterns observed
5. Any notable conventions in how models are organized

Be concise and factual. Use only what is evident from the metadata provided.
Output only the markdown document, no explanation.
`.trim();
}

export function buildNamingConventionsPrompt(models: DbtModel[], semanticModels: SemanticModel[]): string {
  const modelNames = models.slice(0, 50).map(m => m.name);
  const semanticNames = semanticModels.slice(0, 20).map(s => s.name);
  const columnNames = models
    .slice(0, 20)
    .flatMap(m => Object.keys(m.columns))
    .slice(0, 100);

  return `
You are a dbt naming conventions expert. Analyze the following names from a dbt project and
produce a naming conventions reference document in markdown.

Model names (sample):
${modelNames.join(', ')}

Semantic model names (sample):
${semanticNames.join(', ')}

Column names (sample):
${columnNames.join(', ')}

Produce a markdown document covering:
1. File and model naming patterns (prefixes, suffixes, separators)
2. Column naming patterns (IDs, dates, amounts, flags, foreign keys)
3. Semantic model naming conventions
4. Entity, dimension, and measure naming patterns
5. Any observable standards for abbreviations or domain prefixes

Be specific and use examples from the names provided.
Output only the markdown document, no explanation.
`.trim();
}

export function buildSourceIndexPrompt(semanticModels: SemanticModel[]): string {
  const sourceRefs = [...new Set(semanticModels.map(s => s.model))];

  return `
You are a dbt documentation expert. Produce a source index document in markdown based on
the following semantic model metadata.

Semantic models and their source references:
${semanticModels.map(s => `- ${s.name} → ${s.model} (entities: ${s.entities.map(e => e.name).join(', ')})`).join('\n')}

Unique source model references:
${sourceRefs.join(', ')}

Produce a markdown document that:
1. Lists each source model reference and what semantic models consume it
2. Identifies likely entity relationships between semantic models
3. Notes any shared entities or dimensions across models
4. Summarizes the coverage of the semantic layer

Output only the markdown document, no explanation.
`.trim();
}

export function buildPatternLibraryPrompt(models: DbtModel[], semanticModels: SemanticModel[]): string {
  const entityTypes = semanticModels.flatMap(s => s.entities.map(e => e.type));
  const aggTypes = semanticModels.flatMap(s => s.measures.map(m => m.agg));
  const dimTypes = semanticModels.flatMap(s => s.dimensions.map(d => d.type));

  const entityTypeCounts = entityTypes.reduce((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {} as Record<string, number>);
  const aggCounts = aggTypes.reduce((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {} as Record<string, number>);
  const dimCounts = dimTypes.reduce((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {} as Record<string, number>);

  return `
You are a dbt expert. Analyze the following patterns from an existing semantic layer
and produce a pattern library document in markdown.

Semantic model count: ${semanticModels.length}
Entity type distribution: ${JSON.stringify(entityTypeCounts)}
Aggregation type distribution: ${JSON.stringify(aggCounts)}
Dimension type distribution: ${JSON.stringify(dimCounts)}

Example semantic models:
${semanticModels.slice(0, 5).map(s => `
Model: ${s.name}
  Entities: ${s.entities.map(e => `${e.name} (${e.type})`).join(', ')}
  Dimensions: ${s.dimensions.map(d => `${d.name} (${d.type})`).join(', ')}
  Measures: ${s.measures.map(m => `${m.name} (${m.agg})`).join(', ')}
`).join('\n')}

Produce a markdown pattern library covering:
1. Common entity patterns and when to use each type
2. Common dimension patterns (time vs categorical)
3. Common measure patterns and aggregation choices
4. Recurring semantic model structures observed
5. Recommended patterns for new semantic model development

Output only the markdown document, no explanation.
`.trim();
}
