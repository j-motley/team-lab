import * as vscode from 'vscode';
import { DiagnosticsService } from '../core/types';

export class DiagnosticsServiceImpl implements DiagnosticsService, vscode.Disposable {
  private collection = vscode.languages.createDiagnosticCollection('team-lab');

  report(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): void {
    this.collection.set(uri, diagnostics);
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.collection.delete(uri);
    } else {
      this.collection.clear();
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}
