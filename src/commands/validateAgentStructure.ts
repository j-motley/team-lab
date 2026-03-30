import * as vscode from 'vscode';
import { TeamLabStructureService, TeamLabLogger } from '../types/teamLabTypes';
import { getWorkspaceRoot } from '../utils/workspace';

export async function validateAgentStructure(
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
  logger.info('=== Team Lab: Validate Agent Structure ===');

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Team Lab: Validating agent structure',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Inspecting workspace...' });

      const result = await structureService.validate(workspaceRoot);

      progress.report({ message: 'Building summary...' });

      // Determine readiness state
      let readiness: string;
      if (result.isCompliant) {
        readiness = 'Agent-ready';
      } else if (result.missingRequiredPaths.length === 0 && !result.baseline.isReady) {
        readiness = 'Scaffolded but not ready';
      } else {
        readiness = 'Missing structure';
      }

      logger.info(`--- Validation Complete ---`);
      logger.info(`Spec version: ${result.specVersion}`);
      logger.info(`Readiness: ${readiness}`);
      logger.info(`Total paths checked: ${result.items.length}`);
      logger.info(`Missing required: ${result.missingRequiredPaths.length}`);
      logger.info(`Baseline exists: ${result.baseline.exists}`);
      logger.info(`Baseline ready: ${result.baseline.isReady}`);

      if (result.missingRequiredPaths.length > 0) {
        logger.info('Missing paths:');
        for (const p of result.missingRequiredPaths) {
          logger.info(`  - ${p}`);
        }
      }

      // Show summary notification
      if (result.isCompliant) {
        vscode.window.showInformationMessage(
          `Team Lab: Structure is agent-ready. ${result.items.length} paths checked.`
        );
      } else if (result.missingRequiredPaths.length > 0) {
        const choice = await vscode.window.showWarningMessage(
          `Team Lab: ${result.missingRequiredPaths.length} required paths missing. Run scaffold to create them.`,
          'Scaffold Now'
        );
        if (choice === 'Scaffold Now') {
          await vscode.commands.executeCommand('teamLab.scaffoldAgentStructure');
        }
      } else if (!result.baseline.isReady) {
        vscode.window.showWarningMessage(
          'Team Lab: Structure exists but repo_baseline.md needs to be completed before agents can proceed.'
        );
      }
    }
  );
}
