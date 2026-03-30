import * as vscode from 'vscode';
import * as path from 'path';
import { TeamLabStructureService, TeamLabLogger, ModelUpdateService } from '../types/teamLabTypes';
import { getWorkspaceRoot } from '../utils/workspace';

export async function updateModel(
  structureService: TeamLabStructureService,
  modelUpdateService: ModelUpdateService,
  logger: TeamLabLogger
): Promise<void> {
  let workspaceRoot: string;
  try {
    workspaceRoot = getWorkspaceRoot();
  } catch {
    vscode.window.showErrorMessage('Team Lab: No workspace folder is open.');
    return;
  }

  logger.show();
  logger.info('=== Team Lab: Update Model (Prototype) ===');

  // 1. Enforce baseline
  logger.info('Checking repo baseline...');
  const baseline = await structureService.getBaselineStatus(workspaceRoot);

  if (!baseline.exists) {
    logger.warn('repo_baseline.md does not exist. Run Scaffold Agent Structure first.');
    vscode.window.showErrorMessage(
      'Team Lab: repo_baseline.md is missing. Run "Team Lab: Scaffold Agent Structure" first.'
    );
    return;
  }

  if (!baseline.isReady) {
    logger.warn('repo_baseline.md is still in template state.');
    const choice = await vscode.window.showWarningMessage(
      'Team Lab: repo_baseline.md must be completed before using agent workflows.',
      'Open Baseline'
    );
    if (choice === 'Open Baseline') {
      const baselineUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0].uri,
        'ai_context',
        'repo_baseline.md'
      );
      await vscode.window.showTextDocument(baselineUri);
    }
    return;
  }

  logger.info('Baseline is ready.');

  // 2. Pick a SQL model file
  const sqlFiles = await vscode.workspace.findFiles('**/*.sql', '**/target/**');
  if (!sqlFiles.length) {
    logger.warn('No SQL files found in workspace.');
    vscode.window.showWarningMessage('Team Lab: No SQL model files found in the workspace.');
    return;
  }

  const fileItems = sqlFiles.map(uri => ({
    label: path.basename(uri.fsPath),
    description: vscode.workspace.asRelativePath(uri),
    uri,
  }));

  const picked = await vscode.window.showQuickPick(fileItems, {
    title: 'Team Lab: Update Model (1/2)',
    placeHolder: 'Select a dbt model to update',
  });
  if (!picked) { return; }

  // 3. Ask what the user wants to change
  const userRequest = await vscode.window.showInputBox({
    title: 'Team Lab: Update Model (2/2)',
    prompt: 'Describe the change you want to make',
    placeHolder: 'e.g. Add a customer_lifetime_value column based on total orders',
    validateInput: v => v.trim() ? undefined : 'A description is required',
  });
  if (!userRequest) { return; }

  logger.info(`Model: ${picked.description}`);
  logger.info(`Request: ${userRequest}`);

  // 4. Call ModelUpdateService
  let result: Awaited<ReturnType<ModelUpdateService['updateModel']>>;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Team Lab: Generating model update...',
        cancellable: false,
      },
      async () => {
        return await modelUpdateService.updateModel({
          workspaceRoot,
          modelPath: picked.uri.fsPath,
          userRequest,
        });
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Update model failed: ${msg}`);
    vscode.window.showErrorMessage(`Team Lab: Update model failed — ${msg}`);
    return;
  }

  if (!result.success || !result.updatedSql) {
    logger.error(`Update model failed: ${result.message}`);
    vscode.window.showErrorMessage(`Team Lab: ${result.message}`);
    return;
  }

  // 5. Show diff
  const originalUri = picked.uri;
  const updatedUri = vscode.Uri.parse(
    `untitled:${picked.description}.updated.sql`
  );

  const doc = await vscode.workspace.openTextDocument(updatedUri);
  const editor = await vscode.window.showTextDocument(doc);
  await editor.edit(editBuilder => {
    editBuilder.insert(new vscode.Position(0, 0), result.updatedSql!);
  });

  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    updatedUri,
    `Model Update: ${picked.label}`
  );

  logger.info('Diff view opened. Review the changes and apply manually if correct.');

  const choice = await vscode.window.showInformationMessage(
    'Team Lab: Model update generated. Review the diff and apply if correct.',
    'Apply Changes',
    'Discard'
  );

  if (choice === 'Apply Changes') {
    try {
      const fs = await import('fs/promises');
      await fs.writeFile(picked.uri.fsPath, result.updatedSql!, 'utf-8');
      logger.info(`Applied changes to ${picked.description}`);
      vscode.window.showInformationMessage(`Team Lab: Changes applied to ${picked.label}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to write: ${msg}`);
      vscode.window.showErrorMessage(`Team Lab: Failed to apply changes.`);
    }
  } else {
    logger.info('Changes discarded by user.');
  }
}
