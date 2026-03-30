import { Feature } from '../core/types';
import { GenerateContextDocumentsFeature } from './generateContextDocuments';
import { GenerateSemanticModelFeature } from './generateSemanticModel';
import { GenerateContextualSemanticModelFeature } from './generateContextualSemanticModel';

/**
 * All features registered with the extension.
 *
 * To add a new feature:
 *   1. Create a folder under src/features/<yourFeature>/
 *   2. Export a class that implements the Feature interface
 *      (set tier to 'foundational' or 'development')
 *   3. Add an instance of it to this array
 *   4. Add the command ID(s) to package.json under contributes.commands
 *
 * That's it. No other files need to change.
 * See CONTRIBUTING.md for full guidance.
 */
export const allFeatures: Feature[] = [
  // ── Foundational (build/refresh project context) ──────────────────────────
  new GenerateContextDocumentsFeature(),

  // ── Development (semantic layer work) ─────────────────────────────────────
  new GenerateSemanticModelFeature(),
  new GenerateContextualSemanticModelFeature(),
];
