import * as vscode from 'vscode';
import { ServiceContainer } from './types';
import { AiProfileServiceImpl } from '../services/aiProfileService';
import { DelegatingAiService } from '../services/aiService';
import { DbtProjectServiceImpl } from '../services/dbtProjectService';
import { WorkspaceServiceImpl } from '../services/workspaceService';
import { DiagnosticsServiceImpl } from '../services/diagnosticsService';
import { ContextStoreServiceImpl } from '../services/contextStoreService';

export function buildServiceContainer(context: vscode.ExtensionContext): ServiceContainer {
  const workspace = new WorkspaceServiceImpl();
  const aiProfiles = new AiProfileServiceImpl(context);
  const ai = new DelegatingAiService(aiProfiles, context);
  const dbtProject = new DbtProjectServiceImpl(workspace);
  const diagnostics = new DiagnosticsServiceImpl();
  const contextStore = new ContextStoreServiceImpl(workspace);

  context.subscriptions.push(diagnostics);

  return { ai, aiProfiles, dbtProject, workspace, diagnostics, contextStore, vscodeContext: context };
}
