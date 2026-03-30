export type TeamLabOwnedFileKind = 'generated' | 'seeded' | 'human-required';

export interface TeamLabPathSpec {
  path: string;
  type: 'file' | 'directory';
  required: boolean;
  ownership?: TeamLabOwnedFileKind;
  templateId?: string;
  protected?: boolean;
}

export interface TeamLabStructureSpec {
  version: string;
  paths: TeamLabPathSpec[];
}

export interface TeamLabPathStatus {
  path: string;
  type: 'file' | 'directory';
  exists: boolean;
  required: boolean;
  ownership?: TeamLabOwnedFileKind;
  willCreate: boolean;
  templateId?: string;
}

export interface TeamLabBaselineStatus {
  path: string;
  exists: boolean;
  isTemplate: boolean;
  isReady: boolean;
  requiresUserAction: boolean;
}

export interface TeamLabValidationResult {
  workspaceRoot: string;
  specVersion: string;
  isCompliant: boolean;
  checkedAt: string;
  items: TeamLabPathStatus[];
  missingRequiredPaths: string[];
  baseline: TeamLabBaselineStatus;
  createdPaths?: string[];
  skippedPaths?: string[];
  errors?: string[];
}

export interface TeamLabScaffoldOptions {
  createOptional?: boolean;
}

export interface TeamLabTemplateContext {
  workspaceName: string;
  generatedAt: string;
}

export interface TeamLabLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  show(preserveFocus?: boolean): void;
}

export interface TeamLabTemplateProvider {
  render(templateId: string, context: TeamLabTemplateContext): string;
}

export interface TeamLabStructureService {
  validate(workspaceRoot: string): Promise<TeamLabValidationResult>;
  scaffold(workspaceRoot: string, options?: TeamLabScaffoldOptions): Promise<TeamLabValidationResult>;
  getBaselineStatus(workspaceRoot: string): Promise<TeamLabBaselineStatus>;
}

export interface ModelUpdateResult {
  success: boolean;
  originalSql: string;
  updatedSql?: string;
  message: string;
}

export interface ModelUpdateParams {
  workspaceRoot: string;
  modelPath: string;
  userRequest: string;
}

export interface ModelUpdateService {
  updateModel(params: ModelUpdateParams): Promise<ModelUpdateResult>;
}
