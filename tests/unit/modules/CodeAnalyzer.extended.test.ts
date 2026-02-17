import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CodeAnalyzer } from '../../../src/modules/analyzer/CodeAnalyzer.js';

const richCode = `
import x from 'libx';
export default function main(input){
  var password = "hardcoded-secret-123";
  const q = "select * from users where id=" + input;
  db.query(q);
  const data = fetch('/api/user');
  eval(data);
  document.write = input;
  element.innerHTML = input;
  if (Math.random() > 0.5) setTimeout("alert(1)", 10);
  return helper(input);
}
function helper(v){ return v + 42; }
const arrow = (x) => x ? helper(x) : 0;
class Observer {
  subscribe(){} unsubscribe(){} notify(){}
}
function a1(){ return helper(1); }
function a2(){ return helper(1); }
`;

describe('CodeAnalyzer extended', () => {
  function makeAnalyzer() {
    const llm = {
      generateCodeAnalysisPrompt: () => [{ role: 'user', content: 'x' }],
      chat: async () => ({
        content: JSON.stringify({
          techStack: { framework: 'React', bundler: 'Webpack', libraries: ['lodash'] },
          businessLogic: { mainFeatures: ['login'], dataFlow: 'request -> render' },
          securityRisks: [{ type: 'xss', severity: 'high', description: 'risk', location: { line: 1 } }],
          qualityScore: 77,
        }),
      }),
    };
    return new CodeAnalyzer(llm as any) as any;
  }

  it('runs end-to-end understand and returns structured analysis', async () => {
    const analyzer = makeAnalyzer();
    const result = await analyzer.understand({
      code: richCode,
      focus: 'all',
      context: { app: 'demo' },
    });

    assert.ok(result.structure.functions.length > 0);
    assert.ok(result.techStack.framework);
    assert.ok(Array.isArray(result.securityRisks));
    assert.ok(typeof result.qualityScore === 'number');
    assert.ok(result.complexityMetrics.cyclomaticComplexity >= 1);
  });

  it('covers private analyzers and helper methods', async () => {
    const analyzer = makeAnalyzer();

    const modules = analyzer.analyzeModules(richCode);
    assert.ok(modules.length >= 1);

    const structure = await analyzer.analyzeStructure(richCode);
    const cg = analyzer.buildCallGraph(structure.functions, richCode);
    assert.ok(cg.nodes.length >= 1);

    const ai = await analyzer.aiAnalyze(richCode, 'security');
    const tech = analyzer.detectTechStack(richCode, ai);
    assert.ok(tech.framework || tech.bundler || tech.other);

    const logic = analyzer.extractBusinessLogic(ai, { env: 'test' });
    assert.ok(logic.dataModel.env === 'test');

    const dataFlow = await analyzer.analyzeDataFlow(richCode);
    assert.ok(Array.isArray(dataFlow.sources));
    assert.ok(Array.isArray(dataFlow.sinks));
    assert.ok(Array.isArray(dataFlow.graph.nodes));

    const risks = analyzer.identifySecurityRisks(richCode, ai);
    assert.ok(risks.length >= 1);

    const { patterns, antiPatterns } = analyzer.detectCodePatterns(richCode);
    assert.ok(Array.isArray(patterns));
    assert.ok(Array.isArray(antiPatterns));

    const metrics = analyzer.analyzeComplexityMetrics(richCode);
    assert.ok(metrics.cyclomaticComplexity >= 1);
    assert.ok(metrics.maintainabilityIndex >= 0);

    const score = analyzer.calculateQualityScore(structure, risks, ai, metrics, antiPatterns);
    assert.ok(score >= 0 && score <= 100);
  });

  it('covers sanitizer/memberName/duplicate/similarity helpers', () => {
    const analyzer = makeAnalyzer();
    const t = (analyzer.constructor as any).prototype;

    const memberName = analyzer.getMemberExpressionName({
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'DOMPurify' },
      property: { type: 'Identifier', name: 'sanitize' },
      computed: false,
    });
    assert.strictEqual(memberName, 'DOMPurify.sanitize');

    const isSanitizer = analyzer.checkSanitizer(
      {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'DOMPurify' },
          property: { type: 'Identifier', name: 'sanitize' },
          computed: false,
        },
        arguments: [],
      },
      new Set(['DOMPurify.sanitize']),
    );
    assert.strictEqual(isSanitizer, true);

    // direct helper usage through generated AST nodes
    const fakeNode: any = {
      type: 'Identifier',
      name: 'x',
      loc: { start: { line: 1 }, end: { line: 1 } },
    };
    const h = analyzer.computeASTHash(fakeNode);
    assert.ok(typeof h === 'string');

    const n = analyzer.normalizeCode({
      type: 'FunctionDeclaration',
      id: { type: 'Identifier', name: 'foo' },
      params: [],
      body: { type: 'BlockStatement', body: [] },
      generator: false,
      async: false,
    });
    assert.ok(typeof n === 'string');

    assert.strictEqual(analyzer.calculateCodeSimilarity('abc', 'abc'), 1);
    assert.ok(analyzer.calculateCodeSimilarity('abc', 'xyz') <= 1);
    assert.ok(t); // keep reference used
  });

  it('covers fallback/error branches across analyzer methods', async () => {
    const llm = {
      generateCodeAnalysisPrompt: () => [],
      chat: async () => ({ content: 'plain text response' }),
      generateTaintAnalysisPrompt: () => [],
    };
    const analyzer = new CodeAnalyzer(llm as any) as any;

    // aiAnalyze: raw text fallback
    const raw = await analyzer.aiAnalyze('const a=1', 'all');
    assert.strictEqual(typeof raw.rawAnalysis, 'string');

    // aiAnalyze: error fallback
    analyzer.llm.chat = async () => {
      throw new Error('llm down');
    };
    const empty = await analyzer.aiAnalyze('const b=1', 'all');
    assert.deepStrictEqual(empty, {});

    // understand catch path
    const originalAnalyzeStructure = analyzer.analyzeStructure;
    analyzer.analyzeStructure = async () => {
      throw new Error('boom');
    };
    await assert.rejects(
      async () => {
        await analyzer.understand({ code: 'const x=1' });
      },
      /boom/,
    );
    analyzer.analyzeStructure = originalAnalyzeStructure;

    // parse failure branches
    const badStructure = await analyzer.analyzeStructure('function(');
    assert.ok(Array.isArray(badStructure.functions));
    const badModules = analyzer.analyzeModules('import ');
    assert.deepStrictEqual(badModules, []);
    const badGraph = analyzer.buildCallGraph([], 'function(');
    assert.deepStrictEqual(badGraph.edges, []);
    const badFlow = await analyzer.analyzeDataFlow('function(');
    assert.deepStrictEqual(Array.isArray(badFlow.sources), true);
  });

  it('covers tech stack/business logic/security/pattern complexity branches', async () => {
    const analyzer = makeAnalyzer();

    const vue = analyzer.detectTechStack('Vue.createApp({})', {});
    assert.strictEqual(vue.framework, 'Vue');
    const ng = analyzer.detectTechStack('@angular/core', {});
    assert.strictEqual(ng.framework, 'Angular');
    const crypto = analyzer.detectTechStack('JSEncrypt;crypto-js;__webpack_require__', {});
    assert.strictEqual(crypto.bundler, 'Webpack');
    assert.ok(Array.isArray(crypto.cryptoLibrary));

    const logic = analyzer.extractBusinessLogic(
      { businessLogic: { mainFeatures: ['f1'], dataFlow: 'a->b' } },
      undefined,
    );
    assert.strictEqual(logic.rules.length, 1);

    const secCode = `
      var password = "hardcoded-password-value-123";
      const token = "secret-value-abc";
      user.innerHTML = input;
      document.write = input;
      eval(input);
      Function(input);
      setTimeout("alert(1)", 10);
      db.query("select * from t where id=" + input);
      const n = Math.random() + 1;
    `;
    const risks = analyzer.identifySecurityRisks(secCode, {
      securityRisks: [{ type: 'xss', severity: 'high', location: { line: 4 }, description: 'ai-risk' }],
    });
    assert.ok(risks.length >= 4);

    const patternCode = `
      var single = (function(){ return {x:1}; })();
      class Obs { subscribe(){} unsubscribe(){} notify(){} }
      function longFn(){
${'        doWork(12345);\n'.repeat(55)}
      }
      try {} catch(e) {}
      if(a){ if(b){ if(c){ if(d){ val = 9999; } } } }
    `;
    const pat = analyzer.detectCodePatterns(patternCode);
    assert.ok(pat.patterns.length >= 1);
    assert.ok(pat.antiPatterns.length >= 1);

    const metrics = analyzer.analyzeComplexityMetrics('if(a&&b){for(;;){break;}}');
    assert.ok(metrics.cyclomaticComplexity >= 2);
    const metricsFail = analyzer.analyzeComplexityMetrics('function(');
    assert.ok(metricsFail.cyclomaticComplexity >= 1);
  });

  it('covers taint-flow enhancement and duplicate code helper branches', async () => {
    const llm = {
      generateCodeAnalysisPrompt: () => [],
      generateTaintAnalysisPrompt: () => [{ role: 'user', content: 'taint' }],
      chat: async () => ({
        content: JSON.stringify({
          taintPaths: [
            {
              source: { type: 'network', location: { file: 'current', line: 1 } },
              sink: { type: 'eval', location: { file: 'current', line: 9 } },
              path: [{ file: 'current', line: 1 }, { file: 'current', line: 9 }],
            },
          ],
        }),
      }),
    };
    const analyzer = new CodeAnalyzer(llm as any) as any;
    const code = `
      const input = location.href;
      const cookie = document.cookie;
      const storage = localStorage.getItem("k");
      const sess = sessionStorage.getItem("k2");
      const winName = window.name;
      const pm = event.data;
      const ws = message.data;
      const a = client.fetch();
      const b = a + "x";
      const c = fn(b);
      let z;
      z = c;
      eval(input);
      eval(z);
      document.write(input);
      document.write(z);
      db.query("select * from t where id=" + z);
      cp.exec(z);
      fs.readFile(z);
      el.innerHTML = z;
      const clean = encodeURIComponent(z);
      setTimeout(z, 10);
    `;
    const flow = await analyzer.analyzeDataFlow(code);
    assert.ok(flow.sources.length >= 4);
    assert.ok(flow.sinks.length >= 4);
    assert.ok(flow.taintPaths.length >= 1);

    // LLM enhancement error branch
    analyzer.llm.chat = async () => {
      throw new Error('llm-fail');
    };
    await analyzer.enhanceTaintAnalysisWithLLM(code, flow.sources, flow.sinks, flow.taintPaths);

    // checkTaintedArguments no-op branch
    const taintMap = new Map<string, any>();
    const taintPaths: any[] = [];
    analyzer.checkTaintedArguments([{ type: 'StringLiteral', value: 'x' }], taintMap, taintPaths, 'eval', 1);
    assert.strictEqual(taintPaths.length, 0);

    // detectDuplicateCode catch branch
    const dupFail = analyzer.detectDuplicateCode({} as any);
    assert.deepStrictEqual(dupFail, []);
  });
});
