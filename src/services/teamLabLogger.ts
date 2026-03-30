import * as vscode from 'vscode';
import { TeamLabLogger } from '../types/teamLabTypes';

export class VsCodeTeamLabLogger implements TeamLabLogger {
  constructor(private readonly output: vscode.OutputChannel) {}

  info(message: string): void {
    this.output.appendLine(`[INFO] ${message}`);
  }

  warn(message: string): void {
    this.output.appendLine(`[WARN] ${message}`);
  }

  error(message: string): void {
    this.output.appendLine(`[ERROR] ${message}`);
  }

  show(preserveFocus = true): void {
    this.output.show(preserveFocus);
  }
}
