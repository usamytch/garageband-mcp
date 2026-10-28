import { acquireGuiLock, defaultGuiLockPath } from '../../test-build/src/gui-queue.js';
import { canonicalProjectPath, verifyProject } from '../../test-build/src/project-guard.js';
import { operationContext } from '../../test-build/src/operation-context.js';
import { runAX } from '../../test-build/src/native-ax.js';
import { readFile, writeFile } from 'node:fs/promises';

const [project, script, journal, parameters = '{}'] = process.argv.slice(2);
if (!project || !script || !journal) throw new Error('Usage: node run-ax.mjs PROJECT.band SCRIPT.jxa NEW-JOURNAL.json [PARAMETERS.json-string]');
const projectPath = await canonicalProjectPath(project);
const source = 'const params = ' + JSON.stringify(JSON.parse(parameters)) + ';\n' + await readFile(script, 'utf8');
await writeFile(journal, JSON.stringify({ projectPath, script, status: 'pending' }, null, 2), { flag: 'wx' });
const release = await acquireGuiLock(defaultGuiLockPath);
try {
  await verifyProject(projectPath);
  const result = await operationContext.run({ projectPath, verify: () => verifyProject(projectPath) }, () => runAX(source));
  await writeFile(journal, JSON.stringify({ projectPath, script, result }, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(journal, JSON.stringify({ projectPath, script, error: String(error), inspectBeforeRetrying: true }, null, 2));
  throw error;
} finally { await release(); }
