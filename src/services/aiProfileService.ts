import * as vscode from 'vscode';
import { AiProfile, AiProfileService } from '../core/types';

const CONFIG_KEY = 'teamLab.aiProfiles';
const ACTIVE_KEY = 'teamLab.activeAiProfileId';
const SECRET_PREFIX = 'teamLab.apiKey.';

export class AiProfileServiceImpl implements AiProfileService {
  private _onDidChangeActiveProfile = new vscode.EventEmitter<AiProfile | null>();
  readonly onDidChangeActiveProfile = this._onDidChangeActiveProfile.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  getProfiles(): AiProfile[] {
    return vscode.workspace
      .getConfiguration()
      .get<AiProfile[]>(CONFIG_KEY, []);
  }

  getActiveProfile(): AiProfile | null {
    const activeId = vscode.workspace
      .getConfiguration()
      .get<string>(ACTIVE_KEY, '');
    if (!activeId) {return null;}
    return this.getProfiles().find(p => p.id === activeId) ?? null;
  }

  async setActiveProfile(id: string): Promise<void> {
    await vscode.workspace
      .getConfiguration()
      .update(ACTIVE_KEY, id, vscode.ConfigurationTarget.Global);
    this._onDidChangeActiveProfile.fire(this.getActiveProfile());
  }

  async addProfile(profile: AiProfile, apiKey?: string): Promise<void> {
    const profiles = this.getProfiles();
    const existing = profiles.findIndex(p => p.id === profile.id);
    if (existing >= 0) {
      profiles[existing] = profile;
    } else {
      profiles.push(profile);
    }
    await vscode.workspace
      .getConfiguration()
      .update(CONFIG_KEY, profiles, vscode.ConfigurationTarget.Global);

    if (apiKey) {
      await this.context.secrets.store(`${SECRET_PREFIX}${profile.id}`, apiKey);
    }
  }

  async removeProfile(id: string): Promise<void> {
    const profiles = this.getProfiles().filter(p => p.id !== id);
    await vscode.workspace
      .getConfiguration()
      .update(CONFIG_KEY, profiles, vscode.ConfigurationTarget.Global);
    await this.context.secrets.delete(`${SECRET_PREFIX}${id}`);

    const activeId = vscode.workspace
      .getConfiguration()
      .get<string>(ACTIVE_KEY, '');
    if (activeId === id) {
      await vscode.workspace
        .getConfiguration()
        .update(ACTIVE_KEY, '', vscode.ConfigurationTarget.Global);
      this._onDidChangeActiveProfile.fire(null);
    }
  }

  async getApiKey(profileId: string): Promise<string | undefined> {
    return this.context.secrets.get(`${SECRET_PREFIX}${profileId}`);
  }
}
