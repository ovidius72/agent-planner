import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const repo = resolve(process.argv[2] ?? '/Users/antonio/projects/agent-plan');
const require = createRequire(join(repo, 'package.json'));
const ts = require('typescript');
const file = 'packages/plan-core/src/plan-store.ts';
const absoluteFile = join(repo, file);
const original = readFileSync(absoluteFile, 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');

// Syntax fingerprints deliberately ignore trivia, never literals or operators.
function tokens(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    result.push([kind, scanner.getTokenText()]);
  }
  return JSON.stringify(result);
}

function enclosingName(node) {
  const parts = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)) && parent.name) {
      parts.unshift(parent.name.text);
    }
  }
  return parts.join('.');
}

function descriptor(node, sf) {
  if (!node.name || !node.body) return undefined;
  if (!ts.isMethodDeclaration(node) && !ts.isFunctionDeclaration(node)) return undefined;
  const scope = enclosingName(node);
  const name = node.name.getText(sf);
  const kind = ts.isMethodDeclaration(node) ? 'method' : 'function';
  const start = node.getStart(sf);
  return {
    key: `${scope ? `${scope}.` : ''}${name}`,
    kind,
    scope,
    name,
    path: relative(repo, sf.fileName),
    line: sf.getLineAndCharacterOfPosition(start).line + 1,
    start,
    end: node.end,
    declarationHash: hash(tokens(node.getText(sf))),
    bodyHash: hash(tokens(node.body.getText(sf))),
    signatureShapeHash: hash(tokens(node.getText(sf).slice(0, node.body.getStart(sf) - start).replace(name, '__anchor_name__'))),
  };
}

function index(text, path = file, workspace = 'proof-worktree-A') {
  const sf = ts.createSourceFile(join(repo, path), text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = [];
  function visit(node) {
    const info = descriptor(node, sf);
    if (info) declarations.push(info);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { workspace, path, sourceHash: hash(text), parseErrors: sf.parseDiagnostics.length, declarations };
}

const baselineIndex = index(original);
const target = baselineIndex.declarations.find((item) => item.key === 'PlanStore.claimTask');
assert.ok(target, 'The real PlanStore.claimTask declaration must exist.');
const baseline = { anchorId: 'proof-anchor-claim-task', ...target };

const configPath = join(repo, 'packages/plan-core/tsconfig.json');
const rawConfig = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(rawConfig.error, undefined);
const config = ts.parseJsonConfigFileContent(rawConfig.config, ts.sys, dirname(configPath));
const program = ts.createProgram(config.fileNames, { ...config.options, noEmit: true });
const checker = program.getTypeChecker();
const source = program.getSourceFile(absoluteFile);
assert.ok(source);
let targetNode;
function findTarget(node) {
  if (descriptor(node, source)?.key === baseline.key) targetNode = node;
  ts.forEachChild(node, findTarget);
}
findTarget(source);
assert.ok(targetNode);

// Collect directly resolved project callees. This is not a complete runtime call graph.
const dependencies = new Map();
function visitCalls(node) {
  if (ts.isCallExpression(node)) {
    const declaration = checker.getResolvedSignature(node)?.declaration;
    if (declaration) {
      const sf = declaration.getSourceFile();
      const path = relative(repo, sf.fileName);
      if (path.startsWith('packages/plan-core/src/')) {
        const info = descriptor(declaration, sf);
        if (info && info.key !== baseline.key) dependencies.set(`${path}:${info.key}`, info);
      }
    }
  }
  ts.forEachChild(node, visitCalls);
}
visitCalls(targetNode.body);
assert.ok([...dependencies.values()].some((dep) => dep.key === 'PlanStore.loadAllPhases'));

function dependencyFingerprint(currentIndex) {
  return hash(JSON.stringify([...dependencies.entries()].sort().map(([key, dep]) => {
    const current = dep.path === currentIndex.path
      ? currentIndex.declarations.find((item) => item.key === dep.key)
      : dep;
    return [key, current?.declarationHash ?? 'missing'];
  })));
}
baseline.dependencyFingerprint = dependencyFingerprint(baselineIndex);

function resolveAnchor(currentIndex, currentText, workspace = 'proof-worktree-A') {
  if (workspace !== currentIndex.workspace) return { location: 'wrong-worktree', reviewRequired: true };
  if (hash(currentText) !== currentIndex.sourceHash) return { location: 'stale-index', reviewRequired: true };
  if (currentIndex.parseErrors) return { location: 'unknown', reviewRequired: true };
  const exact = currentIndex.declarations.filter((item) => item.path === baseline.path && item.key === baseline.key && item.kind === baseline.kind);
  if (exact.length === 1) {
    const targetChanged = exact[0].declarationHash !== baseline.declarationHash;
    const dependenciesChanged = dependencyFingerprint(currentIndex) !== baseline.dependencyFingerprint;
    return {
      location: 'resolved',
      line: exact[0].line,
      targetChanged,
      dependenciesChanged,
      reviewRequired: targetChanged || dependenciesChanged,
    };
  }
  const candidates = currentIndex.declarations.filter((item) => item.kind === baseline.kind
    && item.bodyHash === baseline.bodyHash && item.signatureShapeHash === baseline.signatureShapeHash);
  return {
    location: candidates.length > 1 ? 'ambiguous' : candidates.length === 1 ? 'candidate' : 'missing',
    candidates: candidates.map(({ path, key, line }) => ({ path, key, line })),
    reviewRequired: true,
  };
}

const results = [];
function check(name, actual, expected) {
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${name}: ${key}`);
  results.push({ name, result: actual, passed: true });
}
const replaceTarget = (text) => original.slice(0, target.start) + text + original.slice(target.end);
const targetText = original.slice(target.start, target.end);

check('unchanged declaration', resolveAnchor(baselineIndex, original), { location: 'resolved', reviewRequired: false });

const shifted = `${'\n'.repeat(80)}${original}`;
const shiftedResult = resolveAnchor(index(shifted), shifted);
check('80 inserted lines preserve the target', shiftedResult, { location: 'resolved', line: target.line + 80, targetChanged: false, reviewRequired: false });

const changedTargetText = targetText.replace('Task not found.', 'Task lookup failed.');
assert.notEqual(changedTargetText, targetText);
const bodyChanged = replaceTarget(changedTargetText);
check('changed method body requires review', resolveAnchor(index(bodyChanged), bodyChanged), { location: 'resolved', targetChanged: true, reviewRequired: true });

const renamedText = targetText.replace('async claimTask(', 'async acquireTask(');
assert.notEqual(renamedText, targetText);
const renamed = replaceTarget(renamedText);
check('external rename is a candidate, never an automatic rebinding', resolveAnchor(index(renamed), renamed), { location: 'candidate', reviewRequired: true });

const movedIndex = index(original, 'packages/plan-core/src/relocated-plan-store.ts');
check('external file move is a candidate', resolveAnchor(movedIndex, original), { location: 'candidate', reviewRequired: true });

const duplicate = replaceTarget(`${renamedText}\n${targetText.replace('async claimTask(', 'async acquireTaskAlternative(')}`);
const duplicateResult = resolveAnchor(index(duplicate), duplicate);
check('two equivalent destinations remain ambiguous', duplicateResult, { location: 'ambiguous', reviewRequired: true });
assert.equal(duplicateResult.candidates.length, 2);

const deleted = replaceTarget('');
check('deleted declaration does not point to unrelated code', resolveAnchor(index(deleted), deleted), { location: 'missing', reviewRequired: true });

const invalidSource = 'export class PlanStore { async claimTask(';
check('parse failure is unknown, not a claim of deletion', resolveAnchor(index(invalidSource), invalidSource), { location: 'unknown', reviewRequired: true });

const dependency = baselineIndex.declarations.find((item) => item.key === 'PlanStore.loadAllPhases');
assert.ok(dependency);
const dependencyText = original.slice(dependency.start, dependency.end);
const bodyStart = dependencyText.indexOf('{');
assert.ok(bodyStart >= 0);
const editedDependency = dependencyText.slice(0, bodyStart + 1) + '\nvoid 0;\n' + dependencyText.slice(bodyStart + 1);
const dependencyChanged = original.slice(0, dependency.start) + editedDependency + original.slice(dependency.end);
check('changed direct callee invalidates review despite unchanged target', resolveAnchor(index(dependencyChanged), dependencyChanged), { location: 'resolved', targetChanged: false, dependenciesChanged: true, reviewRequired: true });

check('live source hash rejects an outdated index', resolveAnchor(baselineIndex, shifted), { location: 'stale-index', reviewRequired: true });
check('cached positions from another worktree are refused', resolveAnchor(baselineIndex, original, 'proof-worktree-B'), { location: 'wrong-worktree', reviewRequired: true });

const report = {
  timestamp: new Date().toISOString(),
  repo,
  typescriptVersion: ts.version,
  symbol: baseline.key,
  baselineLine: target.line,
  directResolvedProjectCallees: [...dependencies.values()].map(({ path, key }) => ({ path, symbol: key })).sort((a, b) => a.symbol.localeCompare(b.symbol)),
  passed: results.length,
  total: results.length,
  results,
  limitations: [
    'Standalone proof, not integrated into Agent Plan.',
    'Mutable scenarios are in-memory transformations, not writes to the repository.',
    'Rename/move candidates require confirmation and do not prove continuity of intent.',
    'Direct compiler-resolved callees only; no complete dynamic or transitive runtime graph.',
    'Token hashes do not prove semantic equivalence or correctness of prose.',
    'Only class methods and function declarations are covered by this proof.',
    'Comments are excluded from syntax hashes; production must track documentation and raw source revisions separately.',
  ],
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'code-anchor-proof-results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, total: report.total, symbol: report.symbol, baselineLine: report.baselineLine, directResolvedCallees: report.directResolvedProjectCallees.length, results: results.map(({ name, result }) => ({ name, ...result })) }, null, 2));
