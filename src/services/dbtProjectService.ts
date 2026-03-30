import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  DbtProjectService,
  DbtProjectInfo,
  DbtModel,
  DbtColumn,
  SemanticModel,
  WorkspaceService,
} from '../core/types';

const MIN_DBT_VERSION = [1, 7, 0];

// ─── Raw YAML shapes (loosely typed for resilience) ───────────────────────────

interface RawDbtProjectYaml {
  name?: string;
  version?: string | number;
  'require-dbt-version'?: string | string[];
  'model-paths'?: string[];
}

interface RawModelYaml {
  models?: RawModelEntry[];
  semantic_models?: RawSemanticModelEntry[];
}

interface RawModelEntry {
  name?: string;
  description?: string;
  columns?: Array<{ name?: string; description?: string; data_type?: string }>;
}

interface RawSemanticModelEntry {
  name?: string;
  model?: string;
  entities?: Array<{ name?: string; type?: string; expr?: string; description?: string }>;
  dimensions?: Array<{ name?: string; type?: string; expr?: string; description?: string }>;
  measures?: Array<{ name?: string; agg?: string; expr?: string; description?: string }>;
}

// ─── Service implementation ───────────────────────────────────────────────────

export class DbtProjectServiceImpl implements DbtProjectService {
  private projectInfo: DbtProjectInfo | null = null;

  constructor(private readonly workspace: WorkspaceService) {}

  async detect(): Promise<DbtProjectInfo | null> {
    try {
      const raw = await this.workspace.readFile('dbt_project.yml');
      const parsed = yaml.load(raw) as RawDbtProjectYaml;

      const requireVersion = parsed['require-dbt-version'] ?? null;
      const modelPaths = parsed['model-paths'] ?? ['models'];

      this.projectInfo = {
        name: parsed.name ?? 'unknown',
        version: String(parsed.version ?? ''),
        requireDbtVersion: requireVersion,
        modelPaths,
        isVersionCompatible: this.checkVersionCompatibility(requireVersion),
      };

      if (!this.projectInfo.isVersionCompatible) {
        vscode.window.showWarningMessage(
          `Team Lab requires dbt 1.7+. ` +
          `This project specifies "${JSON.stringify(requireVersion)}". ` +
          `Some features may not work correctly.`
        );
      }

      return this.projectInfo;
    } catch {
      return null;
    }
  }

  async getModels(): Promise<DbtModel[]> {
    const info = this.projectInfo ?? await this.detect();
    if (!info) {return [];}

    const modelPaths = info.modelPaths;
    const results: DbtModel[] = [];

    for (const modelPath of modelPaths) {
      const uris = await this.workspace.findFiles(`${modelPath}/**/*.yml`);
      for (const uri of uris) {
        const models = await this.parseModelsFromFile(uri);
        results.push(...models);
      }
    }

    // Layer in manifest enrichment if available
    await this.enrichFromManifest(results);

    return results;
  }

  async getSemanticModels(): Promise<SemanticModel[]> {
    const info = this.projectInfo ?? await this.detect();
    if (!info) {return [];}

    const results: SemanticModel[] = [];
    const uris = await this.workspace.findFiles('**/*.yml');

    for (const uri of uris) {
      const semanticModels = await this.parseSemanticModelsFromFile(uri);
      results.push(...semanticModels);
    }

    return results;
  }

  async findModelByName(name: string): Promise<DbtModel | null> {
    const models = await this.getModels();
    return models.find(m => m.name === name) ?? null;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async parseModelsFromFile(uri: vscode.Uri): Promise<DbtModel[]> {
    try {
      const content = await this.workspace.readFile(
        vscode.workspace.asRelativePath(uri)
      );
      const parsed = yaml.load(content) as RawModelYaml;
      if (!parsed?.models) {return [];}

      return parsed.models
        .filter(m => !!m.name)
        .map(m => ({
          name: m.name!,
          path: uri.fsPath,
          description: m.description,
          columns: Object.fromEntries(
            (m.columns ?? [])
              .filter(c => !!c.name)
              .map(c => [
                c.name!,
                { name: c.name!, dataType: c.data_type, description: c.description } as DbtColumn,
              ])
          ),
        }));
    } catch {
      return [];
    }
  }

  private async parseSemanticModelsFromFile(uri: vscode.Uri): Promise<SemanticModel[]> {
    try {
      const content = await this.workspace.readFile(
        vscode.workspace.asRelativePath(uri)
      );
      const parsed = yaml.load(content) as RawModelYaml;
      if (!parsed?.semantic_models) {return [];}

      return parsed.semantic_models
        .filter(s => !!s.name)
        .map(s => ({
          name: s.name!,
          model: s.model ?? '',
          sourcePath: uri.fsPath,
          entities: (s.entities ?? []).map(e => ({
            name: e.name ?? '',
            type: (e.type as SemanticModel['entities'][0]['type']) ?? 'primary',
            expr: e.expr,
            description: e.description,
          })),
          dimensions: (s.dimensions ?? []).map(d => ({
            name: d.name ?? '',
            type: (d.type as 'categorical' | 'time') ?? 'categorical',
            expr: d.expr,
            description: d.description,
          })),
          measures: (s.measures ?? []).map(m => ({
            name: m.name ?? '',
            agg: m.agg ?? 'count',
            expr: m.expr,
            description: m.description,
          })),
        }));
    } catch {
      return [];
    }
  }

  private async enrichFromManifest(models: DbtModel[]): Promise<void> {
    const manifestPath = path.join('target', 'manifest.json');
    const exists = await this.workspace.fileExists(manifestPath);
    if (!exists) {return;}

    try {
      const raw = await this.workspace.readFile(manifestPath);
      const manifest = JSON.parse(raw) as {
        nodes?: Record<string, { name?: string; columns?: Record<string, { data_type?: string; description?: string }> }>;
      };

      for (const model of models) {
        const node = Object.values(manifest.nodes ?? {}).find(n => n.name === model.name);
        if (!node) {continue;}

        for (const [colName, colData] of Object.entries(node.columns ?? {})) {
          if (model.columns[colName]) {
            model.columns[colName].dataType ??= colData.data_type;
            model.columns[colName].description ??= colData.description;
          } else {
            model.columns[colName] = {
              name: colName,
              dataType: colData.data_type,
              description: colData.description,
            };
          }
        }
      }
    } catch {
      // manifest enrichment is optional — silently skip on error
    }
  }

  private checkVersionCompatibility(requireVersion: string | string[] | null): boolean {
    if (!requireVersion) {return true;}

    const versions = Array.isArray(requireVersion) ? requireVersion : [requireVersion];
    const minConstraint = versions.find(v => v.includes('>='));
    if (!minConstraint) {return true;}

    const match = minConstraint.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
    if (!match) {return true;}

    const [, major, minor, patch] = match.map(Number);
    const [minMajor, minMinor, minPatch] = MIN_DBT_VERSION;

    if (major > minMajor) {return true;}
    if (major === minMajor && minor > minMinor) {return true;}
    if (major === minMajor && minor === minMinor && patch >= minPatch) {return true;}
    return false;
  }
}
