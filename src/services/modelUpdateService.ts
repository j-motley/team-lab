import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ModelUpdateService,
  ModelUpdateParams,
  ModelUpdateResult,
  TeamLabLogger,
} from '../types/teamLabTypes';
import { AiService } from '../core/types';

export class CopilotModelUpdateService implements ModelUpdateService {
  constructor(
    private readonly aiService: AiService,
    private readonly logger: TeamLabLogger
  ) {}

  async updateModel(params: ModelUpdateParams): Promise<ModelUpdateResult> {
    const { workspaceRoot, modelPath, userRequest } = params;

    // Read model SQL
    let originalSql: string;
    try {
      originalSql = await fs.readFile(modelPath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to read model file: ${msg}`);
      return { success: false, originalSql: '', message: `Could not read model file: ${msg}` };
    }

    // Read baseline for context
    let baselineContent = '';
    try {
      baselineContent = await fs.readFile(
        path.join(workspaceRoot, 'ai_context', 'repo_baseline.md'),
        'utf-8'
      );
    } catch {
      // baseline content is optional context enrichment
    }

    // Build prompt
    const prompt = `You are an expert dbt/SQL developer. You are given a dbt model SQL file and a change request.

## Repository Baseline
${baselineContent}

## Current Model SQL
\`\`\`sql
${originalSql}
\`\`\`

## Change Request
${userRequest}

## Instructions
- Apply the requested change to the model SQL
- Preserve existing style, CTE patterns, and naming conventions
- Output ONLY the complete updated SQL — no explanation, no markdown fences, no commentary
- If the request is unclear or impossible, output the original SQL unchanged and add a SQL comment at the top explaining why`;

    // Call AI
    this.logger.info('Sending to AI...');
    let updatedSql: string;
    try {
      updatedSql = await this.aiService.complete(prompt, {
        systemPrompt:
          'You are an expert analytics engineer. Output only valid SQL. ' +
          'Preserve existing patterns and conventions.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI call failed: ${msg}`);
      return { success: false, originalSql, message: `AI request failed: ${msg}` };
    }

    this.logger.info('AI response received.');

    return {
      success: true,
      originalSql,
      updatedSql,
      message: 'Model update generated successfully.',
    };
  }
}
