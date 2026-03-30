import * as vscode from 'vscode';
import * as path from 'path';
import { Feature, ServiceContainer, Contribution, ContextDocument } from '../../core/types';
import { buildContextualPrompt } from './prompt';
import { parseAiOutput } from '../generateSemanticModel/parser';
import { buildProvenanceBlock } from '../../services/contextStoreService';

export class GenerateContextualSemanticModelFeature implements Feature {
  readonly id = 'teamLab.generateContextualSemanticModel';
  readonly displayName = 'Generate Contextual Semantic Model';
  readonly tier = 'development' as const;

  activate(services: ServiceContainer): Contribution[] {
    const cmd = vscode.commands.registerCommand(this.id, () => this.run(services));
    return [{ disposable: cmd }];
  }

  private async run(services: ServiceContainer): Promise<void> {
    const { ai, dbtProject, workspace, contextStore } = services;

    // 1. Warn if no context documents exist yet
    const availableTypes = await contextStore.getAvailableTypes();
    if (!availableTypes.length) {
      const choice = await vscode.window.showWarningMessage(
        'No context documents found. Generate them first for better results, or continue without context.',
        'Generate Context Documents',
        'Continue Anyway'
      );
      if (choice === 'Generate Context Documents') {
        await vscode.commands.executeCommand('teamLab.generateContextDocuments');
        return;
      }
      if (!choice) {return;}
    }

    // 2. Warn about stale documents
    const staleTypes = (
      await Promise.all(availableTypes.map(async t => ({ t, stale: await contextStore.isStale(t) })))
    )
      .filter(x => x.stale)
      .map(x => x.t);

    if (staleTypes.length) {
      const choice = await vscode.window.showWarningMessage(
        `Some context documents are stale: ${staleTypes.join(', ')}. Results may not reflect recent project changes.`,
        'Refresh First',
        'Continue Anyway'
      );
      if (choice === 'Refresh First') {
        await vscode.commands.executeCommand('teamLab.generateContextDocuments');
        return;
      }
      if (!choice) {return;}
    }

    // 3. Pick a model
    const models = await dbtProject.getModels();
    if (!models.length) {
      vscode.window.showWarningMessage('Team Lab: No dbt models found in this project.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      models.map(m => ({
        label: m.name,
        description: vscode.workspace.asRelativePath(m.path),
        model: m,
      })),
      { placeHolder: 'Select a dbt model to generate a contextual semantic definition for' }
    );
    if (!picked) {return;}

    // 4. Check for existing semantic model
    const existing = await dbtProject.getSemanticModels();
    const alreadyExists = existing.some(s => s.model.includes(picked.model.name));
    if (alreadyExists) {
      const proceed = await vscode.window.showWarningMessage(
        `A semantic model referencing "${picked.model.name}" already exists. Generate anyway?`,
        { modal: true },
        'Generate'
      );
      if (proceed !== 'Generate') {return;}
    }

    // 5. Load context documents
    const contextDocs = await contextStore.readAll();

    // 6. Build prompt and call AI
    const prompt = buildContextualPrompt(picked.model, contextDocs);
    let rawOutput = '';

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Generating contextual semantic model for "${picked.model.name}"…`,
        cancellable: false,
      },
      async () => {
        rawOutput = await ai.complete(prompt, {
          systemPrompt:
            'You have been provided with project-specific context documents. ' +
            'Follow the naming conventions, patterns, and standards described in those documents exactly. ' +
            'Output only valid YAML with no additional commentary.',
        });
      }
    );

    // 7. Parse output
    const result = parseAiOutput(rawOutput);
    if (!result.valid) {
      const choice = await vscode.window.showErrorMessage(
        `Team Lab: The AI output could not be parsed as valid YAML. ${result.error ?? ''}`,
        'Show Raw Output'
      );
      if (choice === 'Show Raw Output') {
        const doc = await vscode.workspace.openTextDocument({ content: rawOutput, language: 'yaml' });
        await vscode.window.showTextDocument(doc);
      }
      return;
    }

    // 8. Prepend provenance block
    const provenance = buildProvenanceBlock(contextDocs);
    const finalContent = provenance + result.yaml + '\n';

    // 9. Write file
    const outputRelPath = path.join('models', 'semantic', `${picked.model.name}.yml`);
    await workspace.writeFile(outputRelPath, finalContent);

    // 10. Open the new file
    const root = workspace.getRootPath();
    if (root) {
      const uri = vscode.Uri.file(path.join(root, outputRelPath));
      await workspace.showDocument(uri);
    }

    const contextSummary = contextDocs.length
      ? `using ${contextDocs.length} context document(s)`
      : 'without context documents';

    vscode.window.showInformationMessage(
      `Contextual semantic model written to ${outputRelPath} (${contextSummary}). Review before committing.`
    );
  }
}
