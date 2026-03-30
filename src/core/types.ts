import * as vscode from 'vscode';

// ─── AI Provider Profiles ─────────────────────────────────────────────────────

export type AiProviderType = 'copilot' | 'anthropic' | 'openai';

export interface AiProfile {
  id: string;
  name: string;
  provider: AiProviderType;
  model: string;
}

export interface AiOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

// ─── Services ─────────────────────────────────────────────────────────────────

export interface AiService {
  complete(prompt: string, options?: AiOptions): Promise<string>;
  stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Promise<void>;
}

export interface AiProfileService {
  getProfiles(): AiProfile[];
  getActiveProfile(): AiProfile | null;
  setActiveProfile(id: string): Promise<void>;
  addProfile(profile: AiProfile, apiKey?: string): Promise<void>;
  removeProfile(id: string): Promise<void>;
  getApiKey(profileId: string): Promise<string | undefined>;
  onDidChangeActiveProfile: vscode.Event<AiProfile | null>;
}

export interface WorkspaceService {
  getRootPath(): string | null;
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  findFiles(glob: string): Promise<vscode.Uri[]>;
  showDocument(uri: vscode.Uri): Promise<void>;
  fileExists(relativePath: string): Promise<boolean>;
}

export interface DbtProjectService {
  detect(): Promise<DbtProjectInfo | null>;
  getModels(): Promise<DbtModel[]>;
  getSemanticModels(): Promise<SemanticModel[]>;
  findModelByName(name: string): Promise<DbtModel | null>;
}

export interface DiagnosticsService {
  report(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): void;
  clear(uri?: vscode.Uri): void;
}

// ─── Context Store ────────────────────────────────────────────────────────────

export type ContextDocumentType =
  | 'architecture'
  | 'naming_conventions'
  | 'source_index'
  | 'pattern_library'
  | 'governance_index'
  | 'product_catalog';

export interface ContextDocument {
  /** UUID v4 assigned at generation time. Stable across reads. */
  id: string;
  type: ContextDocumentType;
  generatedAt: Date;
  /** Markdown content, excluding the header block */
  content: string;
}

export interface ContextStoreService {
  /** Write or overwrite a context document. Assigns a new UUID on each write. */
  write(type: ContextDocumentType, content: string): Promise<ContextDocument>;
  /** Read a context document. Returns null if not yet generated. */
  read(type: ContextDocumentType): Promise<ContextDocument | null>;
  /** Read all available context documents. */
  readAll(): Promise<ContextDocument[]>;
  /** Returns true if the document is older than thresholdHours (default 24). */
  isStale(type: ContextDocumentType, thresholdHours?: number): Promise<boolean>;
  /** Returns which document types have been generated. */
  getAvailableTypes(): Promise<ContextDocumentType[]>;
}

// ─── Service Container ────────────────────────────────────────────────────────

export interface ServiceContainer {
  ai: AiService;
  aiProfiles: AiProfileService;
  dbtProject: DbtProjectService;
  workspace: WorkspaceService;
  diagnostics: DiagnosticsService;
  contextStore: ContextStoreService;
  vscodeContext: vscode.ExtensionContext;
}

// ─── Feature ──────────────────────────────────────────────────────────────────

export interface Contribution {
  disposable: vscode.Disposable;
}

/**
 * Feature tiers:
 *   foundational — scans the project and builds/refreshes context documents.
 *                  Run occasionally when the project changes.
 *   development  — does semantic layer work for the user, optionally consuming
 *                  context documents produced by foundational features.
 */
export type FeatureTier = 'foundational' | 'development';

export interface Feature {
  readonly id: string;
  readonly displayName: string;
  readonly tier: FeatureTier;
  activate(services: ServiceContainer): Contribution[] | Promise<Contribution[]>;
  deactivate?(): void | Promise<void>;
}

// ─── dbt Domain Types ─────────────────────────────────────────────────────────

export interface DbtProjectInfo {
  name: string;
  version: string;
  requireDbtVersion: string | string[] | null;
  modelPaths: string[];
  isVersionCompatible: boolean;
}

export interface DbtModel {
  name: string;
  path: string;
  columns: Record<string, DbtColumn>;
  description?: string;
}

export interface DbtColumn {
  name: string;
  dataType?: string;
  description?: string;
}

export interface SemanticModel {
  name: string;
  model: string;
  sourcePath: string;
  entities: Entity[];
  dimensions: Dimension[];
  measures: Measure[];
}

export interface Entity {
  name: string;
  type: 'primary' | 'foreign' | 'natural' | 'unique';
  expr?: string;
  description?: string;
}

export interface Dimension {
  name: string;
  type: 'categorical' | 'time';
  expr?: string;
  description?: string;
}

export interface Measure {
  name: string;
  agg: string;
  expr?: string;
  description?: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class AiProfileNotConfiguredError extends Error {
  constructor() {
    super('No AI profile is configured. Please add a profile in Team Lab settings.');
    this.name = 'AiProfileNotConfiguredError';
  }
}

export class AiProfileUnavailableError extends Error {
  readonly cause?: Error;
  constructor(public readonly profileId: string, cause?: Error) {
    super(`AI profile "${profileId}" is unavailable.`);
    this.name = 'AiProfileUnavailableError';
    this.cause = cause;
  }
}
