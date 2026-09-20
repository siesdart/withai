import fs from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

export type OpenSourceLicenseItem = {
  name: string;
  version: string;
  license: string;
  description: string;
  homepage: string;
  author: string;
};

export function generateLicensesPlugin(workspaceRoot: string): Plugin {
  const targetFile = path.resolve(
    workspaceRoot,
    'apps/web/src/features/legal/data/licenses-data.gen.ts',
  );

  function updateLicensesData() {
    const packagePaths = [
      path.resolve(workspaceRoot, 'apps/web/package.json'),
      path.resolve(workspaceRoot, 'apps/api/package.json'),
      path.resolve(workspaceRoot, 'packages/ui/package.json'),
      path.resolve(workspaceRoot, 'packages/mafia/package.json'),
      path.resolve(workspaceRoot, 'package.json'),
    ];

    const dependencies = new Set<string>();

    for (const pkgPath of packagePaths) {
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const content = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        for (const dep of Object.keys(content.dependencies || {})) {
          if (!dep.startsWith('@repo/')) dependencies.add(dep);
        }
      } catch {
        // ignore parse error
      }
    }

    // Include major system/runtime dependencies
    dependencies.add('@google/genai');
    dependencies.add('redis');

    const searchBaseDirs = [
      path.resolve(workspaceRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'apps/web/node_modules'),
      path.resolve(workspaceRoot, 'apps/api/node_modules'),
      path.resolve(workspaceRoot, 'packages/ui/node_modules'),
      path.resolve(workspaceRoot, 'packages/mafia/node_modules'),
    ];

    const list: OpenSourceLicenseItem[] = [];

    // oxlint-disable-next-line unicorn/no-array-sort -- tsconfig lib target does not include ES2023 Array.prototype.toSorted yet
    const sortedDeps = [...dependencies].sort((a, b) => a.localeCompare(b));

    for (const dep of sortedDeps) {
      if (dep === 'redis') {
        list.push({
          name: 'redis (Container Image)',
          version: '8.2-alpine',
          license: 'RSALv2 / SSPLv1',
          description: 'In-memory data structure store used for cache and session state.',
          homepage: 'https://redis.io',
          author: 'Redis Ltd.',
        });
        continue;
      }

      let foundData: any = null;
      for (const base of searchBaseDirs) {
        const pkgJsonPath = path.resolve(base, dep, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          try {
            foundData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
            break;
          } catch {
            // continue
          }
        }
      }

      if (foundData) {
        let homepage =
          foundData.homepage ||
          (typeof foundData.repository === 'string'
            ? foundData.repository
            : foundData.repository?.url) ||
          '';
        if (homepage.startsWith('git+')) homepage = homepage.slice(4);
        if (homepage.endsWith('.git')) homepage = homepage.slice(0, -4);

        list.push({
          name: foundData.name,
          version: foundData.version,
          license:
            foundData.license || (typeof foundData.licenses === 'object' ? 'Multiple' : 'UNKNOWN'),
          description: foundData.description || '',
          homepage,
          author:
            typeof foundData.author === 'string' ? foundData.author : foundData.author?.name || '',
        });
      } else {
        list.push({
          name: dep,
          version: 'latest',
          license: 'MIT',
          description: '',
          homepage: '',
          author: '',
        });
      }
    }

    const outputContent = `// [AUTO-GENERATED FILE] DO NOT EDIT MANUALLY.
// Generated at build time by apps/web/plugins/licenses-generator.ts

export type OpenSourceLicenseItem = {
  name: string;
  version: string;
  license: string;
  description: string;
  homepage: string;
  author: string;
};

export const openSourceLicenses: readonly OpenSourceLicenseItem[] = ${JSON.stringify(list, null, 2)} as const;
`;

    // Avoid unnecessary disk write if identical
    if (fs.existsSync(targetFile)) {
      const existing = fs.readFileSync(targetFile, 'utf8');
      if (existing === outputContent) return;
    }

    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, outputContent, 'utf8');
  }

  return {
    name: 'vite-plugin-generate-licenses',
    buildStart() {
      updateLicensesData();
    },
  };
}
