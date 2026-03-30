import * as vscode from 'vscode';
import * as path from 'path';
import { Feature, ServiceContainer, Contribution } from '../../core/types';
import { buildGenerationPrompt } from './prompt';
import { parseAiOutput } from './parser';

export class GenerateSemanticModelFeature implements Feature {
  readonly id = 'teamLab.generateSemanticModel';
  readonly displayName = 'Generate Semantic Model Starter';
  readonly tier = 'development' as const;

  activate(services: ServiceContainer): Contribution[] {
    const cmd = vscode.commands.registerCommand(this.id, () => this.run(services));
    return [{ disposable: cmd }];
  }

  private async run(services: ServiceContainer): Promise<void> {
    const { ai, dbtProject, workspace } = services;

    // 1. Pick a model
    const models = await dbtProject.getModels();
    if (!models.length) {
      vscode.window.showWarningMessage(
        'Team Lab: No dbt models found in this project. ' +
        'Ensure your model YAML files are under the configured model paths.'
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      models.map(m => ({
        label: m.name,
        description: vscode.workspace.asRelativePath(m.path),
        model: m,
      })),
      { placeHolder: 'Select a dbt model to generate a semantic definition for' }
    );
    if (!picked) {return;}

    // 2. Check if a semantic model already exists for this model
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

    // 3. Build prompt and call AI
    const prompt = buildGenerationPrompt(picked.model);
    let rawOutput = '';

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Generating semantic model for "${picked.model.name}"…`,
        cancellable: false,
      },
      async () => {
        rawOutput = await ai.complete(prompt, {
          systemPrompt:
            'You are an expert analytics engineer specializing in dbt semantic layers. ' +
            'Output only valid YAML with no additional commentary.',
        });
      }
    );

    // 4. Parse output
    const result = parseAiOutput(rawOutput);

    if (!result.valid) {
      const choice = await vscode.window.showErrorMessage(
        `Team Lab: The AI output could not be parsed as valid YAML. ${result.error ?? ''}`,
        'Show Raw Output'
      );
      if (choice === 'Show Raw Output') {
        const doc = await vscode.workspace.openTextDocument({
          content: rawOutput,
          language: 'yaml',
        });
        await vscode.window.showTextDocument(doc);
      }
      return;
    }

    // 5. Write file
    const outputRelPath = path.join('models', 'semantic', `${picked.model.name}.yml`);
    await workspace.writeFile(outputRelPath, result.yaml + '\n');

    // 6. Open the new file
    const root = workspace.getRootPath();
    if (root) {
      const uri = vscode.Uri.file(path.join(root, outputRelPath));
      await workspace.showDocument(uri);
    }

    vscode.window.showInformationMessage(
      `Semantic model starter written to ${outputRelPath}. Review and adjust before committing.`
    );
  }
}
