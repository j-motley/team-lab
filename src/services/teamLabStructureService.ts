import * as fs from 'fs/promises';
import * as path from 'path';
import {
  TeamLabStructureService,
  TeamLabValidationResult,
  TeamLabBaselineStatus,
  TeamLabPathStatus,
  TeamLabScaffoldOptions,
  TeamLabLogger,
  TeamLabTemplateProvider,
  TeamLabTemplateContext,
} from '../types/teamLabTypes';
import { TEAM_LAB_STRUCTURE_SPEC } from '../specs/teamLabStructureSpec';

const TEMPLATE_MARKER = '<!-- TEAM_LAB_BASELINE_TEMPLATE -->';
const BASELINE_PATH = 'ai_context/repo_baseline.md';

export class FileSystemTeamLabStructureService implements TeamLabStructureService {
  constructor(
    private readonly logger: TeamLabLogger,
    private readonly templates: TeamLabTemplateProvider
  ) {}

  async validate(workspaceRoot: string): Promise<TeamLabValidationResult> {
    const spec = TEAM_LAB_STRUCTURE_SPEC;
    const items: TeamLabPathStatus[] = [];
    const missingRequiredPaths: string[] = [];

    for (const pathSpec of spec.paths) {
      const fullPath = path.join(workspaceRoot, pathSpec.path);
      this.logger.info(`Checking path: ${pathSpec.path}`);

      const exists = await this.pathExists(fullPath);

      const status: TeamLabPathStatus = {
        path: pathSpec.path,
        type: pathSpec.type,
        exists,
        required: pathSpec.required,
        ownership: pathSpec.ownership,
        willCreate: !exists && pathSpec.required,
        templateId: pathSpec.templateId,
      };

      items.push(status);

      if (!exists && pathSpec.required) {
        missingRequiredPaths.push(pathSpec.path);
        this.logger.warn(`Missing: ${pathSpec.path}`);
      } else if (exists) {
        this.logger.info(`Found: ${pathSpec.path}`);
      }
    }

    const baseline = await this.getBaselineStatus(workspaceRoot);

    if (baseline.exists && baseline.isReady) {
      this.logger.info('repo_baseline.md is present and appears ready');
    } else if (baseline.exists && baseline.isTemplate) {
      this.logger.warn('repo_baseline.md is still template');
      this.logger.info('[ACTION REQUIRED] Update repo_baseline.md before using Team Lab agents');
    } else if (!baseline.exists) {
      this.logger.warn('repo_baseline.md is missing');
      this.logger.info('[ACTION REQUIRED] Update repo_baseline.md before using Team Lab agents');
    }

    const isCompliant = missingRequiredPaths.length === 0 && baseline.isReady;

    const validationResult: TeamLabValidationResult = {
      workspaceRoot,
      specVersion: spec.version,
      isCompliant,
      checkedAt: new Date().toISOString(),
      items,
      missingRequiredPaths,
      baseline,
    };

    // Update manifest with current state (only if ai_context dir exists)
    const aiContextExists = items.some(i => i.path === 'ai_context' && i.exists);
    const manifestExists = items.some(i => i.path === 'ai_context/team_lab_manifest.json' && i.exists);
    if (aiContextExists && manifestExists) {
      await this.updateManifest(workspaceRoot, validationResult);
    }

    return validationResult;
  }

  async scaffold(
    workspaceRoot: string,
    _options?: TeamLabScaffoldOptions
  ): Promise<TeamLabValidationResult> {
    // First validate to see what's missing
    const preValidation = await this.validate(workspaceRoot);

    const createdPaths: string[] = [];
    const skippedPaths: string[] = [];
    const errors: string[] = [];

    const context: TeamLabTemplateContext = {
      workspaceName: path.basename(workspaceRoot),
      generatedAt: new Date().toISOString(),
    };

    this.logger.info('--- Scaffolding missing structure ---');

    for (const item of preValidation.items) {
      const fullPath = path.join(workspaceRoot, item.path);

      if (item.exists) {
        skippedPaths.push(item.path);
        this.logger.info(`Skipped (exists): ${item.path}`);
        continue;
      }

      if (!item.required) {
        continue;
      }

      try {
        if (item.type === 'directory') {
          await fs.mkdir(fullPath, { recursive: true });
          createdPaths.push(item.path);
          this.logger.info(`Created: ${item.path}`);
        } else if (item.type === 'file') {
          // Ensure parent directory exists
          await fs.mkdir(path.dirname(fullPath), { recursive: true });

          let content = '';
          if (item.templateId) {
            content = this.templates.render(item.templateId, context);
          }

          await fs.writeFile(fullPath, content, 'utf-8');
          createdPaths.push(item.path);
          this.logger.info(`Created: ${item.path}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to create ${item.path}: ${message}`);
        this.logger.error(`Failed to create: ${item.path} — ${message}`);
      }
    }

    // Re-validate after scaffolding
    this.logger.info('--- Validating after scaffold ---');
    const postValidation = await this.validate(workspaceRoot);

    // Log summary
    this.logger.info('--- Scaffold Summary ---');
    this.logger.info(`Created: ${createdPaths.length} items`);
    this.logger.info(`Skipped: ${skippedPaths.length} items`);
    if (errors.length) {
      this.logger.error(`Errors: ${errors.length}`);
    }

    if (postValidation.baseline.requiresUserAction) {
      this.logger.info('[ACTION REQUIRED] Update repo_baseline.md before using Team Lab agents');
    }

    return {
      ...postValidation,
      createdPaths,
      skippedPaths,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async getBaselineStatus(workspaceRoot: string): Promise<TeamLabBaselineStatus> {
    const fullPath = path.join(workspaceRoot, BASELINE_PATH);

    const exists = await this.pathExists(fullPath);

    if (!exists) {
      return {
        path: BASELINE_PATH,
        exists: false,
        isTemplate: false,
        isReady: false,
        requiresUserAction: true,
      };
    }

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const isTemplate = content.includes(TEMPLATE_MARKER);

      return {
        path: BASELINE_PATH,
        exists: true,
        isTemplate,
        isReady: !isTemplate,
        requiresUserAction: isTemplate,
      };
    } catch {
      return {
        path: BASELINE_PATH,
        exists: true,
        isTemplate: false,
        isReady: false,
        requiresUserAction: true,
      };
    }
  }

  private async updateManifest(
    workspaceRoot: string,
    result: TeamLabValidationResult
  ): Promise<void> {
    const manifestPath = path.join(workspaceRoot, 'ai_context', 'team_lab_manifest.json');

    // Categorize files by ownership
    const generated: string[] = [];
    const seeded: string[] = [];
    const humanRequired: string[] = [];

    for (const item of result.items) {
      if (item.type === 'file' && item.ownership) {
        switch (item.ownership) {
          case 'generated':
            generated.push(item.path);
            break;
          case 'seeded':
            seeded.push(item.path);
            break;
          case 'human-required':
            humanRequired.push(item.path);
            break;
        }
      }
    }

    // Detect dbt projects
    const detectedProjects: Array<{ name: string; path: string }> = [];
    try {
      const projectIndexPath = path.join(workspaceRoot, 'ai_context', 'project_index.json');
      const raw = await fs.readFile(projectIndexPath, 'utf-8');
      const parsed = JSON.parse(raw) as { projects?: Array<{ name: string; path: string }> };
      if (parsed.projects) {
        detectedProjects.push(...parsed.projects);
      }
    } catch {
      // project index may not exist yet
    }

    const manifest = {
      version: result.specVersion,
      scaffolded_at: result.checkedAt,
      last_validated_at: result.checkedAt,
      detected_projects: detectedProjects,
      structure: {
        github: {
          exists: result.items.some(i => i.path === '.github' && i.exists),
          copilot_instructions: result.items.some(i => i.path === '.github/copilot-instructions.md' && i.exists),
          instructions_dir: result.items.some(i => i.path === '.github/instructions' && i.exists),
          agents_dir: result.items.some(i => i.path === '.github/agents' && i.exists),
          skills_dir: result.items.some(i => i.path === '.github/skills' && i.exists),
        },
        ai_context: {
          exists: result.items.some(i => i.path === 'ai_context' && i.exists),
          project_index: result.items.some(i => i.path === 'ai_context/project_index.json' && i.exists),
          workspace_summary: result.items.some(i => i.path === 'ai_context/workspace_summary.md' && i.exists),
          team_lab_manifest: true,
          repo_baseline: result.baseline.exists,
        },
      },
      baseline: {
        path: result.baseline.path,
        exists: result.baseline.exists,
        is_template: result.baseline.isTemplate,
        is_ready: result.baseline.isReady,
        requires_user_action: result.baseline.requiresUserAction,
      },
      files: {
        generated,
        seeded,
        human_required: humanRequired,
      },
    };

    try {
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      this.logger.info('Updated team_lab_manifest.json');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not update manifest: ${msg}`);
    }
  }

  private async pathExists(fullPath: string): Promise<boolean> {
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}
