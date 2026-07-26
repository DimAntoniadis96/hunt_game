// Decoy clones must be physically solid just like real transformed prop
// players. If only real players collide, hunters can reveal hiders by trying to
// jump/stand on objects.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const gameScenePath = path.join(root, "packages/client/src/game/GameScene.ts");
const mapBuilderPath = path.join(root, "packages/client/src/game/mapBuilder.ts");

function sourceFile(filePath) {
  return ts.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function findFunctionLike(sf, name) {
  let found = null;
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name?.getText(sf) === name
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function hasCollisionHelperCall(sf, node) {
  let found = false;
  const visit = (child) => {
    if (
      ts.isCallExpression(child) &&
      child.expression.getText(sf) === "setPropVisualCollisions" &&
      child.arguments[0]?.getText(sf) === "node" &&
      child.arguments[1]?.kind === ts.SyntaxKind.TrueKeyword
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  if (node) visit(node);
  return found;
}

const gameScene = sourceFile(gameScenePath);
const mapBuilder = sourceFile(mapBuilderPath);
const failures = [];

if (!findFunctionLike(mapBuilder, "setPropVisualCollisions")) {
  failures.push("mapBuilder must expose setPropVisualCollisions()");
}
if (!hasCollisionHelperCall(mapBuilder, findFunctionLike(mapBuilder, "buildStaticProps"))) {
  failures.push("static props must use setPropVisualCollisions(node, true)");
}
if (!hasCollisionHelperCall(gameScene, findFunctionLike(gameScene, "syncVisuals"))) {
  failures.push("real transformed players must use setPropVisualCollisions(node, true)");
}
if (!hasCollisionHelperCall(gameScene, findFunctionLike(gameScene, "syncDecoys"))) {
  failures.push("decoy clones must use setPropVisualCollisions(node, true)");
}

if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}

console.log("Static props, real transformed players, and decoy clones share prop collision setup.");
