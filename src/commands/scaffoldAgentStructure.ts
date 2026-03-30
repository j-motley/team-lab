import * as vscode from 'vscode';
import { TeamLabStructureService, TeamLabLogger } from '../types/teamLabTypes';
import { getWorkspaceRoot } from '../utils/workspace';

export async function scaffoldAgentStructure(
  structureService: TeamLabStructureService,
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
  logger.info('=== Team Lab: Scaffold Agent Structure ===');

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Team Lab: Scaffolding agent structure',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Inspecting workspace...' });

      progress.report({ message: 'Creating missing structure...' });
      const result = await structureService.scaffold(workspaceRoot);

      progress.report({ message: 'Done.' });

      const created = result.createdPaths?.length ?? 0;
      const skipped = result.skippedPaths?.length ?? 0;
      const errCount = result.errors?.length ?? 0;

      // Summary notification
      if (errCount > 0) {
        vscode.window.showErrorMessage(
          `Team Lab: Scaffold completed with ${errCount} error(s). Check the output channel for details.`
        );
      } else if (result.baseline.requiresUserAction) {
        const choice = await vscode.window.showWarningMessage(
          `Team Lab: Scaffold complete (${created} created, ${skipped} skipped). ` +
          `repo_baseline.md requires your input before agents can proceed.`,
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
      } else {
        vscode.window.showInformationMessage(
          `Team Lab: Scaffold complete (${created} created, ${skipped} skipped). Structure is agent-ready.`
        );
      }
    }
  );
}
