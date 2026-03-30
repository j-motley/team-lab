import * as vscode from 'vscode';
import { buildServiceContainer } from './core/serviceContainer';
import { FeatureRegistry } from './core/featureRegistry';
import { StatusBarManager } from './ui/statusBar';
import { allFeatures } from './features';
import { VsCodeTeamLabLogger } from './services/teamLabLogger';
import { TeamLabTemplates } from './services/teamLabTemplates';
import { FileSystemTeamLabStructureService } from './services/teamLabStructureService';
import { validateAgentStructure } from './commands/validateAgentStructure';
import { scaffoldAgentStructure } from './commands/scaffoldAgentStructure';

let registry: FeatureRegistry;
let statusBar: StatusBarManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[Team Lab] Activating…');

  // Team Lab structure services
  const outputChannel = vscode.window.createOutputChannel('Team Lab');
  context.subscriptions.push(outputChannel);
  const teamLabLogger = new VsCodeTeamLabLogger(outputChannel);
  const teamLabTemplates = new TeamLabTemplates();
  const teamLabStructure = new FileSystemTeamLabStructureService(teamLabLogger, teamLabTemplates);

  const services = buildServiceContainer(context);

  // Status bar
  statusBar = new StatusBarManager(services.aiProfiles, services.dbtProject);
  await statusBar.initialize();
  context.subscriptions.push(statusBar);

  // Register the profile picker command (UI concern, lives here not in a feature)
  context.subscriptions.push(
    vscode.commands.registerCommand('teamLab.selectAiProfile', () =>
      showProfilePicker(services.aiProfiles)
    ),
    vscode.commands.registerCommand('teamLab.addAiProfile', () =>
      addAiProfile(services.aiProfiles)
    ),
    vscode.commands.registerCommand('teamLab.validateAgentStructure', () =>
      validateAgentStructure(teamLabStructure, teamLabLogger)
    ),
    vscode.commands.registerCommand('teamLab.scaffoldAgentStructure', () =>
      scaffoldAgentStructure(teamLabStructure, teamLabLogger)
    ),
    vscode.commands.registerCommand('teamLab.getContext', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace open');
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    const fs = require('fs');
    const path = require('path');

    // 🔍 Find dbt projects
    const dbtProjects: any[] = [];

    function findDbtProjects(dir: string) {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);

        try {
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            findDbtProjects(fullPath);
          } else if (item === 'dbt_project.yml') {
            dbtProjects.push({
              name: path.basename(path.dirname(fullPath)),
              path: path.dirname(fullPath)
            });
          }
        } catch {
          // ignore errors
        }
      }
    }

    findDbtProjects(rootPath);

    // 📁 Ensure ai_context folder
    const contextDir = path.join(rootPath, 'ai_context');

    if (!fs.existsSync(contextDir)) {
      fs.mkdirSync(contextDir);
    }

    // 📝 Write project_index.json
    const output = {
      projects: dbtProjects
    };

    fs.writeFileSync(
      path.join(contextDir, 'project_index.json'),
      JSON.stringify(output, null, 2)
    );

    vscode.window.showInformationMessage('🧪 Context synthesized');
  })
);

  // Activate all features
  registry = new FeatureRegistry(allFeatures, services);
  await registry.activateAll();

  context.subscriptions.push({ dispose: () => registry.disposeAll() });

  console.log('[Team Lab] Ready.');
}

export function deactivate(): void {
  // Disposables registered on context.subscriptions are cleaned up automatically.
}

// ─── Add profile ─────────────────────────────────────────────────────────────

async function addAiProfile(profileService: import('./core/types').AiProfileService): Promise<void> {
  const providerItems: vscode.QuickPickItem[] = [
    { label: 'anthropic', description: 'Anthropic (Claude)' },
    { label: 'openai', description: 'OpenAI (GPT)' },
    { label: 'copilot', description: 'GitHub Copilot' },
  ];

  const providerPick = await vscode.window.showQuickPick(providerItems, {
    title: 'Team Lab: Add AI Profile (1/4)',
    placeHolder: 'Select a provider',
  });
  if (!providerPick) { return; }
  const provider = providerPick.label as import('./core/types').AiProviderType;

  const model = await vscode.window.showInputBox({
    title: 'Team Lab: Add AI Profile (2/4)',
    prompt: 'Enter the model name',
    placeHolder: provider === 'anthropic' ? 'e.g. claude-sonnet-4-6' : provider === 'openai' ? 'e.g. gpt-4o' : 'e.g. gpt-4o',
    validateInput: v => v.trim() ? undefined : 'Model name is required',
  });
  if (!model) { return; }

  const name = await vscode.window.showInputBox({
    title: 'Team Lab: Add AI Profile (3/4)',
    prompt: 'Give this profile a name',
    placeHolder: `e.g. My ${providerPick.description}`,
    value: `${providerPick.description} / ${model.trim()}`,
    validateInput: v => v.trim() ? undefined : 'Profile name is required',
  });
  if (!name) { return; }

  let apiKey: string | undefined;
  if (provider !== 'copilot') {
    apiKey = await vscode.window.showInputBox({
      title: 'Team Lab: Add AI Profile (4/4)',
      prompt: 'Enter your API key (stored in VS Code secret storage)',
      password: true,
      validateInput: v => v.trim() ? undefined : 'API key is required',
    });
    if (!apiKey) { return; }
  }

  const profile: import('./core/types').AiProfile = {
    id: `${provider}-${Date.now()}`,
    name: name.trim(),
    provider,
    model: model.trim(),
  };

  await profileService.addProfile(profile, apiKey);
  await profileService.setActiveProfile(profile.id);
  vscode.window.showInformationMessage(`AI profile "${profile.name}" added and activated.`);
}

// ─── Profile picker ───────────────────────────────────────────────────────────

async function showProfilePicker(profileService: import('./core/types').AiProfileService): Promise<void> {
  const profiles = profileService.getProfiles();
  const activeProfile = profileService.getActiveProfile();

  if (!profiles.length) {
    const choice = await vscode.window.showInformationMessage(
      'No AI profiles configured. Add one to get started.',
      'Add Profile'
    );
    if (choice === 'Add Profile') {
      await vscode.commands.executeCommand('teamLab.addAiProfile');
    }
    return;
  }

  const items: vscode.QuickPickItem[] = profiles.map(p => ({
    label: p.name,
    description: `${p.provider} · ${p.model}`,
    detail: p.id === activeProfile?.id ? '$(check) Active' : '',
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Team Lab: Select AI Profile',
    placeHolder: 'Choose an AI profile to activate',
  });

  if (!picked) {return;}

  const selected = profiles.find(p => p.name === picked.label);
  if (selected) {
    await profileService.setActiveProfile(selected.id);
    vscode.window.showInformationMessage(`AI profile switched to "${selected.name}".`);
  }
}
