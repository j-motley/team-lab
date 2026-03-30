import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { WorkspaceService } from '../core/types';

export class WorkspaceServiceImpl implements WorkspaceService {
  getRootPath(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  async readFile(relativePath: string): Promise<string> {
    const fullPath = this.resolve(relativePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolve(relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async findFiles(glob: string): Promise<vscode.Uri[]> {
    return vscode.workspace.findFiles(glob);
  }

  async showDocument(uri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  }

  async fileExists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  private resolve(relativePath: string): string {
    const root = this.getRootPath();
    if (!root) {throw new Error('No workspace folder is open.');}
    return path.join(root, relativePath);
  }
}
