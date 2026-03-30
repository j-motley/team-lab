import * as vscode from 'vscode';
import { Feature, ServiceContainer, Contribution, ContextDocumentType } from '../../core/types';
import {
  buildArchitecturePrompt,
  buildNamingConventionsPrompt,
  buildSourceIndexPrompt,
  buildPatternLibraryPrompt,
} from './prompts';

const DOCUMENT_TYPES: ContextDocumentType[] = [
  'architecture',
  'naming_conventions',
  'source_index',
  'pattern_library',
];

const DOCUMENT_LABELS: Record<ContextDocumentType, string> = {
  architecture: 'Architecture',
  naming_conventions: 'Naming Conventions',
  source_index: 'Source Index',
  pattern_library: 'Pattern Library',
  governance_index: 'Governance Index',
  product_catalog: 'Product Catalog',
};

export class GenerateContextDocumentsFeature implements Feature {
  readonly id = 'teamLab.generateContextDocuments';
  readonly displayName = 'Generate Context Documents';
  readonly tier = 'foundational' as const;

  activate(services: ServiceContainer): Contribution[] {
    const cmd = vscode.commands.registerCommand(this.id, () => this.run(services));
    return [{ disposable: cmd }];
  }

  private async run(services: ServiceContainer): Promise<void> {
    const { ai, dbtProject, contextStore } = services;

    // 1. Confirm the project is detected
    const projectInfo = await dbtProject.detect();
    if (!projectInfo) {
      vscode.window.showWarningMessage(
        'Team Lab: No dbt project detected. Ensure a dbt_project.yml exists in the workspace root.'
      );
      return;
    }

    // 2. Let user pick which documents to generate
    const staleChecks = await Promise.all(
      DOCUMENT_TYPES.map(async t => ({
        type: t,
        stale: await contextStore.isStale(t),
      }))
    );

    const items = staleChecks.map(({ type, stale }) => ({
      label: DOCUMENT_LABELS[type],
      description: stale ? '$(warning) needs refresh' : '$(check) up to date',
      picked: stale,
      type,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Generate Context Documents',
      placeHolder: 'Select documents to generate (stale documents pre-selected)',
      canPickMany: true,
    });

    if (!selected?.length) {return;}

    // 3. Load project data once — shared across all prompts
    const [models, semanticModels] = await Promise.all([
      dbtProject.getModels(),
      dbtProject.getSemanticModels(),
    ]);

    // 4. Generate each selected document
    const selectedTypes = selected.map(s => s.type);
    const generated: string[] = [];

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Team Lab: Generating context documents…',
        cancellable: false,
      },
      async progress => {
        for (const type of selectedTypes) {
          progress.report({ message: DOCUMENT_LABELS[type] });

          const prompt = this.buildPrompt(type, projectInfo, models, semanticModels);
          const content = await ai.complete(prompt, {
            systemPrompt:
              'You are a dbt expert producing reference documentation for an analytics engineering team. ' +
              'Output only clean, well-structured markdown. No explanation or preamble.',
          });

          const doc = await contextStore.write(type, content);
          generated.push(`${DOCUMENT_LABELS[type]} (${doc.id.slice(0, 8)}…)`);
        }
      }
    );

    vscode.window.showInformationMessage(
      `Context documents generated: ${generated.join(', ')}. ` +
      `These will be used automatically when generating contextual semantic models.`
    );
  }

  private buildPrompt(
    type: ContextDocumentType,
    projectInfo: ReturnType<typeof Object.assign>,
    models: Awaited<ReturnType<ServiceContainer['dbtProject']['getModels']>>,
    semanticModels: Awaited<ReturnType<ServiceContainer['dbtProject']['getSemanticModels']>>
  ): string {
    switch (type) {
      case 'architecture':
        return buildArchitecturePrompt(projectInfo, models, semanticModels);
      case 'naming_conventions':
        return buildNamingConventionsPrompt(models, semanticModels);
      case 'source_index':
        return buildSourceIndexPrompt(semanticModels);
      case 'pattern_library':
        return buildPatternLibraryPrompt(models, semanticModels);
      default:
        return `Produce a ${DOCUMENT_LABELS[type]} reference document for this dbt project in markdown.`;
    }
  }
}
