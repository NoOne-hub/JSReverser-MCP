 /**
 * 代码理解模块 - AI辅助代码语义理解
 */

import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
const traverse = (traverseImport as unknown as {default?: typeof traverseImport}).default ?? traverseImport;
import * as t from '@babel/types';
import type {
  UnderstandCodeOptions,
  UnderstandCodeResult,
  CodeStructure,
  TechStack,
  BusinessLogic,
  DataFlow,
  SecurityRisk,
  FunctionInfo,
  ClassInfo,
  CallGraph,
} from '../../types/index.js';
import { LLMService } from '../../services/LLMService.js';
import { logger } from '../../utils/logger.js';

export class CodeAnalyzer {
  private llm: LLMService;

  constructor(llm: LLMService) {
    this.llm = llm;
  }

  /**
   * 理解代码
   */
  async understand(options: UnderstandCodeOptions): Promise<UnderstandCodeResult> {
    logger.info('Starting code understanding...');
    const startTime = Date.now();

    try {
      const { code, context, focus = 'all' } = options;

      // 1. 静态分析 - 提取代码结构
      const structure = await this.analyzeStructure(code);
      logger.debug('Code structure analyzed');

      // 2. AI分析 - 深度理解
      const aiAnalysis = await this.aiAnalyze(code, focus);
      logger.debug('AI analysis completed');

      // 3. 技术栈识别
      const techStack = this.detectTechStack(code, aiAnalysis);
      logger.debug('Tech stack detected');

      // 4. 业务逻辑理解
      const businessLogic = this.extractBusinessLogic(aiAnalysis, context);
      logger.debug('Business logic extracted');

      // 5. 数据流分析
      const dataFlow = await this.analyzeDataFlow(code);
      logger.debug('Data flow analyzed');

      // 6. 安全风险识别
      const securityRisks = this.identifySecurityRisks(code, aiAnalysis);
      logger.debug('Security risks identified');

      // 7. 代码模式和反模式检测
      const { patterns, antiPatterns } = this.detectCodePatterns(code);
      logger.debug(`Detected ${patterns.length} patterns and ${antiPatterns.length} anti-patterns`);

      // 8. 复杂度指标分析
      const complexityMetrics = this.analyzeComplexityMetrics(code);
      logger.debug('Complexity metrics calculated');

      // 9. 代码质量评分（整合新指标）
      const qualityScore = this.calculateQualityScore(
        structure,
        securityRisks,
        aiAnalysis,
        complexityMetrics,
        antiPatterns
      );

      const duration = Date.now() - startTime;
      logger.success(`Code understanding completed in ${duration}ms`);

      return {
        structure,
        techStack,
        businessLogic,
        dataFlow,
        securityRisks,
        qualityScore,
        // 添加新的分析结果
        codePatterns: patterns,
        antiPatterns,
        complexityMetrics,
      };
    } catch (error) {
      logger.error('Code understanding failed', error);
      throw error;
    }
  }

  /**
   * 分析代码结构
   */
  private async analyzeStructure(code: string): Promise<CodeStructure> {
    const functions: FunctionInfo[] = [];
    const classes: ClassInfo[] = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      // 保存this引用以在traverse回调中使用
      const self = this;

      traverse(ast, {
        FunctionDeclaration(path) {
          const node = path.node;
          functions.push({
            name: node.id?.name || 'anonymous',
            params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        FunctionExpression(path) {
          const node = path.node;
          const parent = path.parent;
          let name = 'anonymous';

          if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            name = parent.id.name;
          } else if (parent.type === 'AssignmentExpression' && parent.left.type === 'Identifier') {
            name = parent.left.name;
          }

          functions.push({
            name,
            params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        ArrowFunctionExpression(path) {
          const node = path.node;
          const parent = path.parent;
          let name = 'arrow';

          if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            name = parent.id.name;
          }

          functions.push({
            name,
            params: node.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        ClassDeclaration(path) {
          const node = path.node;
          const methods: FunctionInfo[] = [];
          const properties: ClassInfo['properties'] = [];

          path.traverse({
            ClassMethod(methodPath) {
              const method = methodPath.node;
              methods.push({
                name: method.key.type === 'Identifier' ? method.key.name : 'unknown',
                params: method.params.map((p) => (p.type === 'Identifier' ? p.name : 'unknown')),
                location: {
                  file: 'current',
                  line: method.loc?.start.line || 0,
                  column: method.loc?.start.column,
                },
                complexity: 1,
              });
            },
            ClassProperty(propertyPath) {
              const property = propertyPath.node;
              if (property.key.type === 'Identifier') {
                properties.push({
                  name: property.key.name,
                  type: undefined,
                  value: undefined,
                });
              }
            },
          });

          classes.push({
            name: node.id?.name || 'anonymous',
            methods,
            properties,
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
          });
        },
      });
    } catch (error) {
      logger.warn('Failed to parse code structure', error);
    }

    // 分析模块导入导出
    const modules = this.analyzeModules(code);

    // 构建调用图
    const callGraph = this.buildCallGraph(functions, code);

    return {
      functions,
      classes,
      modules,
      callGraph,
    };
  }

  /**
   * AI深度分析
   */
  private async aiAnalyze(code: string, focus: string): Promise<Record<string, unknown>> {
    try {
      const messages = this.llm.generateCodeAnalysisPrompt(code, focus);
      const response = await this.llm.chat(messages, { temperature: 0.3, maxTokens: 2000 });

      // 尝试解析JSON响应
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      }

      return { rawAnalysis: response.content };
    } catch (error) {
      logger.warn('AI analysis failed, using fallback', error);
      return {};
    }
  }

  /**
   * 检测技术栈
   */
  private detectTechStack(code: string, aiAnalysis: Record<string, unknown>): TechStack {
    const techStack: TechStack = {
      other: [],
    };

    // 从AI分析结果中提取
    if (aiAnalysis.techStack && typeof aiAnalysis.techStack === 'object') {
      const ts = aiAnalysis.techStack as Record<string, unknown>;
      techStack.framework = ts.framework as string | undefined;
      techStack.bundler = ts.bundler as string | undefined;
      if (Array.isArray(ts.libraries)) {
        techStack.other = ts.libraries as string[];
      }
    }

    // 基于代码特征检测
    if (code.includes('React.') || code.includes('useState') || code.includes('useEffect')) {
      techStack.framework = 'React';
    } else if (code.includes('Vue.') || code.includes('createApp')) {
      techStack.framework = 'Vue';
    } else if (code.includes('@angular/')) {
      techStack.framework = 'Angular';
    }

    if (code.includes('__webpack_require__')) {
      techStack.bundler = 'Webpack';
    }

    // 检测加密库
    const cryptoLibs: string[] = [];
    if (code.includes('CryptoJS')) cryptoLibs.push('CryptoJS');
    if (code.includes('JSEncrypt')) cryptoLibs.push('JSEncrypt');
    if (code.includes('crypto-js')) cryptoLibs.push('crypto-js');
    if (cryptoLibs.length > 0) {
      techStack.cryptoLibrary = cryptoLibs;
    }

    return techStack;
  }

  /**
   * 提取业务逻辑
   */
  private extractBusinessLogic(aiAnalysis: Record<string, unknown>, context?: Record<string, unknown>): BusinessLogic {
    const businessLogic: BusinessLogic = {
      mainFeatures: [],
      entities: [],
      rules: [],
      dataModel: {},
    };

    if (aiAnalysis.businessLogic && typeof aiAnalysis.businessLogic === 'object') {
      const bl = aiAnalysis.businessLogic as Record<string, unknown>;
      if (Array.isArray(bl.mainFeatures)) {
        businessLogic.mainFeatures = bl.mainFeatures as string[];
      }
      if (typeof bl.dataFlow === 'string') {
        businessLogic.rules.push(bl.dataFlow);
      }
    }

    // 合并上下文信息
    if (context) {
      businessLogic.dataModel = { ...businessLogic.dataModel, ...context };
    }

    return businessLogic;
  }

  /**
   * 分析模块导入导出
   */
  private analyzeModules(code: string): CodeStructure['modules'] {
    const modules: CodeStructure['modules'] = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      const imports: string[] = [];
      const exports: string[] = [];

      traverse(ast, {
        ImportDeclaration(path) {
          imports.push(path.node.source.value);
        },
        ExportNamedDeclaration(path) {
          if (path.node.source) {
            exports.push(path.node.source.value);
          }
        },
        ExportDefaultDeclaration() {
          exports.push('default');
        },
      });

      if (imports.length > 0 || exports.length > 0) {
        modules.push({
          name: 'current',
          imports,
          exports,
        });
      }
    } catch (error) {
      logger.warn('Module analysis failed', error);
    }

    return modules;
  }

  /**
   * 构建调用图
   */
  private buildCallGraph(functions: FunctionInfo[], code: string): CallGraph {
    const nodes: CallGraph['nodes'] = functions.map((fn) => ({
      id: fn.name,
      name: fn.name,
      type: 'function' as const,
    }));

    const edges: CallGraph['edges'] = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let currentFunction = '';

      traverse(ast, {
        FunctionDeclaration(path) {
          currentFunction = path.node.id?.name || '';
        },
        FunctionExpression(path) {
          const parent = path.parent;
          if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            currentFunction = parent.id.name;
          }
        },
        CallExpression(path) {
          if (currentFunction) {
            const callee = path.node.callee;
            let calledFunction = '';

            if (callee.type === 'Identifier') {
              calledFunction = callee.name;
            } else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
              calledFunction = callee.property.name;
            }

            if (calledFunction && functions.some((f) => f.name === calledFunction)) {
              edges.push({
                from: currentFunction,
                to: calledFunction,
              });
            }
          }
        },
      });
    } catch (error) {
      logger.warn('Call graph construction failed', error);
    }

    return { nodes, edges };
  }

  /**
   * 计算圈复杂度
   */
  private calculateComplexity(path: unknown): number {
    let complexity = 1;

    // 使用any类型绕过类型检查
    const anyPath = path as any;

    if (anyPath.traverse) {
      anyPath.traverse({
        IfStatement() {
          complexity++;
        },
        SwitchCase() {
          complexity++;
        },
        ForStatement() {
          complexity++;
        },
        WhileStatement() {
          complexity++;
        },
        DoWhileStatement() {
          complexity++;
        },
        ConditionalExpression() {
          complexity++;
        },
        LogicalExpression(logicalPath: any) {
          if (logicalPath.node.operator === '&&' || logicalPath.node.operator === '||') {
            complexity++;
          }
        },
        CatchClause() {
          complexity++;
        },
      });
    }

    return complexity;
  }

  /**
   * 分析数据流 - 完整污点分析实现
   *
   * 基于三元组 <sources, sinks, sanitizers> 模型
   * 1. 识别污点源（Source）：用户输入、网络请求、localStorage等
   * 2. 识别污点汇聚点（Sink）：eval、innerHTML、document.write等危险操作
   * 3. 污点传播分析：追踪数据从源到汇的流动路径
   * 4. 无害处理（Sanitizer）：加密、验证等安全处理
   */
  private async analyzeDataFlow(code: string): Promise<DataFlow> {
    const graph: DataFlow['graph'] = { nodes: [], edges: [] };
    const sources: DataFlow['sources'] = [];
    const sinks: DataFlow['sinks'] = [];
    const taintPaths: DataFlow['taintPaths'] = [];

    // 污点标记映射：变量名 -> 污点源信息
    const taintMap = new Map<string, { sourceType: string; sourceLine: number }>();

    // 无害处理函数（Sanitizers）- 检测安全的数据处理
    // 基于OWASP和业界最佳实践扩展
    const sanitizers = new Set([
      // URL编码
      'encodeURIComponent', 'encodeURI', 'escape', 'decodeURIComponent', 'decodeURI',
      // HTML转义
      'htmlentities', 'htmlspecialchars', 'escapeHtml', 'escapeHTML',
      'he.encode', 'he.escape',
      // 验证器库
      'validator.escape', 'validator.unescape', 'validator.stripLow',
      'validator.blacklist', 'validator.whitelist', 'validator.trim',
      'validator.isEmail', 'validator.isURL', 'validator.isInt',
      // DOMPurify
      'DOMPurify.sanitize', 'DOMPurify.addHook',
      // 加密/哈希
      'crypto.encrypt', 'crypto.hash', 'crypto.createHash', 'crypto.createHmac',
      'CryptoJS.AES.encrypt', 'CryptoJS.SHA256', 'CryptoJS.MD5',
      'bcrypt.hash', 'bcrypt.compare',
      // Base64编码
      'btoa', 'atob', 'Buffer.from',
      // SQL参数化
      'db.prepare', 'db.query', 'mysql.escape', 'pg.query',
      // XSS防护
      'xss', 'sanitizeHtml',
      // 输入验证
      'parseInt', 'parseFloat', 'Number', 'String',
      // 其他
      'JSON.stringify', 'JSON.parse',
      'String.prototype.replace', 'String.prototype.trim',
      'Array.prototype.filter', 'Array.prototype.map',
    ]);

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      const self = this;

      // 第一遍遍历：识别污点源和污点汇聚点
      traverse(ast, {
        // 识别污点源
        CallExpression(path) {
          const callee = path.node.callee;
          const line = path.node.loc?.start.line || 0;

          // 网络请求（污点源）
          if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
            const methodName = callee.property.name;

            // 网络请求
            if (['fetch', 'ajax', 'get', 'post', 'request', 'axios'].includes(methodName)) {
              const sourceId = `source-network-${line}`;
              sources.push({ type: 'network', location: { file: 'current', line } });
              graph.nodes.push({
                id: sourceId,
                name: `${methodName}()`,
                type: 'source',
                location: { file: 'current', line },
              });

              // 标记返回值为污点
              const parent = path.parent;
              if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                taintMap.set(parent.id.name, { sourceType: 'network', sourceLine: line });
              }
            }

            // DOM查询（用户输入）
            else if (['querySelector', 'getElementById', 'getElementsByClassName', 'getElementsByTagName'].includes(methodName)) {
              const sourceId = `source-dom-${line}`;
              sources.push({ type: 'user_input', location: { file: 'current', line } });
              graph.nodes.push({
                id: sourceId,
                name: `${methodName}()`,
                type: 'source',
                location: { file: 'current', line },
              });
            }
          }

          // 检测污点汇聚点（危险操作）
          if (t.isIdentifier(callee)) {
            const funcName = callee.name;

            // eval系列 (代码注入)
            if (['eval', 'Function', 'setTimeout', 'setInterval'].includes(funcName)) {
              const sinkId = `sink-eval-${line}`;
              sinks.push({ type: 'eval', location: { file: 'current', line } });
              graph.nodes.push({
                id: sinkId,
                name: `${funcName}()`,
                type: 'sink',
                location: { file: 'current', line },
              });

              // 检查参数是否被污染
              self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, funcName, line);
            }
          }

          // 成员表达式调用的危险方法
          if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
            const methodName = callee.property.name;

            // document.write/writeln (XSS)
            if (['write', 'writeln'].includes(methodName) &&
                t.isIdentifier(callee.object) && callee.object.name === 'document') {
              const sinkId = `sink-document-write-${line}`;
              sinks.push({ type: 'xss', location: { file: 'current', line } });
              graph.nodes.push({
                id: sinkId,
                name: `document.${methodName}()`,
                type: 'sink',
                location: { file: 'current', line },
              });
              self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
            }

            // SQL查询方法 (SQL注入)
            if (['query', 'execute', 'exec', 'run'].includes(methodName)) {
              const sinkId = `sink-sql-${line}`;
              sinks.push({ type: 'sql-injection', location: { file: 'current', line } });
              graph.nodes.push({
                id: sinkId,
                name: `${methodName}() (SQL)`,
                type: 'sink',
                location: { file: 'current', line },
              });
              self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
            }

            // 命令执行 (Command Injection)
            if (['exec', 'spawn', 'execSync', 'spawnSync'].includes(methodName)) {
              const sinkId = `sink-command-${line}`;
              sinks.push({ type: 'other', location: { file: 'current', line } });
              graph.nodes.push({
                id: sinkId,
                name: `${methodName}() (Command)`,
                type: 'sink',
                location: { file: 'current', line },
              });
              self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
            }

            // 路径遍历 (Path Traversal)
            if (['readFile', 'writeFile', 'readFileSync', 'writeFileSync', 'open'].includes(methodName)) {
              const sinkId = `sink-file-${line}`;
              sinks.push({ type: 'other', location: { file: 'current', line } });
              graph.nodes.push({
                id: sinkId,
                name: `${methodName}() (File)`,
                type: 'sink',
                location: { file: 'current', line },
              });
              self.checkTaintedArguments(path.node.arguments, taintMap, taintPaths, methodName, line);
            }
          }
        },

        // 识别更多污点源
        MemberExpression(path) {
          const obj = path.node.object;
          const prop = path.node.property;
          const line = path.node.loc?.start.line || 0;

          // location.* (URL参数)
          if (t.isIdentifier(obj) && obj.name === 'location' && t.isIdentifier(prop)) {
            if (['href', 'search', 'hash', 'pathname'].includes(prop.name)) {
              const sourceId = `source-url-${line}`;
              sources.push({ type: 'user_input', location: { file: 'current', line } });
              graph.nodes.push({
                id: sourceId,
                name: `location.${prop.name}`,
                type: 'source',
                location: { file: 'current', line },
              });

              // 标记为污点
              const parent = path.parent;
              if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                taintMap.set(parent.id.name, { sourceType: 'url', sourceLine: line });
              }
            }
          }

          // document.cookie
          if (t.isIdentifier(obj) && obj.name === 'document' && t.isIdentifier(prop) && prop.name === 'cookie') {
            const sourceId = `source-cookie-${line}`;
            sources.push({ type: 'storage', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: 'document.cookie',
              type: 'source',
              location: { file: 'current', line },
            });
          }

          // localStorage/sessionStorage
          if (t.isIdentifier(obj) && ['localStorage', 'sessionStorage'].includes(obj.name)) {
            const sourceId = `source-storage-${line}`;
            sources.push({ type: 'storage', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: `${obj.name}.getItem()`,
              type: 'source',
              location: { file: 'current', line },
            });
          }

          // window.name (可被跨窗口污染)
          if (t.isIdentifier(obj) && obj.name === 'window' &&
              t.isIdentifier(prop) && prop.name === 'name') {
            const sourceId = `source-window-name-${line}`;
            sources.push({ type: 'user_input', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: 'window.name',
              type: 'source',
              location: { file: 'current', line },
            });
          }

          // postMessage接收 (跨域消息)
          if (t.isIdentifier(obj) && obj.name === 'event' &&
              t.isIdentifier(prop) && prop.name === 'data') {
            const sourceId = `source-postmessage-${line}`;
            sources.push({ type: 'network', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: 'event.data (postMessage)',
              type: 'source',
              location: { file: 'current', line },
            });
          }

          // WebSocket消息
          if (t.isIdentifier(obj) && obj.name === 'message' &&
              t.isIdentifier(prop) && prop.name === 'data') {
            const sourceId = `source-websocket-${line}`;
            sources.push({ type: 'network', location: { file: 'current', line } });
            graph.nodes.push({
              id: sourceId,
              name: 'WebSocket message.data',
              type: 'source',
              location: { file: 'current', line },
            });
          }
        },

        // 识别DOM操作污点汇聚点
        AssignmentExpression(path) {
          const left = path.node.left;
          const right = path.node.right;
          const line = path.node.loc?.start.line || 0;

          // innerHTML, outerHTML (XSS风险)
          if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
            const propName = left.property.name;
            if (['innerHTML', 'outerHTML'].includes(propName)) {
              const sinkId = `sink-dom-${line}`;
              sinks.push({ type: 'xss', location: { file: 'current', line } });
              graph.nodes.push({
                id: sinkId,
                name: propName,
                type: 'sink',
                location: { file: 'current', line },
              });

              // 检查右值是否被污染
              if (t.isIdentifier(right) && taintMap.has(right.name)) {
                const taintInfo = taintMap.get(right.name)!;
                taintPaths.push({
                  source: { type: taintInfo.sourceType as DataFlow['sources'][0]['type'], location: { file: 'current', line: taintInfo.sourceLine } },
                  sink: { type: 'xss', location: { file: 'current', line } },
                  path: [
                    { file: 'current', line: taintInfo.sourceLine },
                    { file: 'current', line },
                  ],
                });
              }
            }
          }
        },
      });

      // 第二遍遍历：污点传播分析（显式流）
      traverse(ast, {
        // 赋值传播
        VariableDeclarator(path) {
          const id = path.node.id;
          const init = path.node.init;

          if (t.isIdentifier(id) && init) {
            // 检查是否经过Sanitizer处理
            if (t.isCallExpression(init) && self.checkSanitizer(init, sanitizers)) {
              // 如果参数是污点变量，经过Sanitizer后清除污点
              const arg = init.arguments[0];
              if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
                // 不传播污点（已被清洗）
                logger.debug(`Taint cleaned by sanitizer: ${arg.name} -> ${id.name}`);
                return;
              }
            }

            // 直接赋值传播
            if (t.isIdentifier(init) && taintMap.has(init.name)) {
              const taintInfo = taintMap.get(init.name)!;
              taintMap.set(id.name, taintInfo);
            }
            // 二元表达式传播
            else if (t.isBinaryExpression(init)) {
              const leftTainted = t.isIdentifier(init.left) && taintMap.has(init.left.name);
              const rightTainted = t.isIdentifier(init.right) && taintMap.has(init.right.name);

              if (leftTainted || rightTainted) {
                const taintInfo = leftTainted ? taintMap.get((init.left as t.Identifier).name)! : taintMap.get((init.right as t.Identifier).name)!;
                taintMap.set(id.name, taintInfo);
              }
            }
            // 函数调用传播（非Sanitizer）
            else if (t.isCallExpression(init)) {
              const arg = init.arguments[0];
              if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
                const taintInfo = taintMap.get(arg.name)!;
                taintMap.set(id.name, taintInfo);
              }
            }
          }
        },

        // 赋值表达式传播
        AssignmentExpression(path) {
          const left = path.node.left;
          const right = path.node.right;

          if (t.isIdentifier(left) && t.isIdentifier(right) && taintMap.has(right.name)) {
            const taintInfo = taintMap.get(right.name)!;
            taintMap.set(left.name, taintInfo);
          }
        },
      });

    } catch (error) {
      logger.warn('Data flow analysis failed', error);
    }

    // 使用LLM辅助进行深度污点分析（如果有污点路径）
    if (taintPaths.length > 0 && this.llm) {
      try {
        await this.enhanceTaintAnalysisWithLLM(code, sources, sinks, taintPaths);
      } catch (error) {
        logger.warn('LLM-enhanced taint analysis failed', error);
      }
    }

    return {
      graph,
      sources,
      sinks,
      taintPaths,
    };
  }

  /**
   * 使用LLM增强污点分析
   *
   * 对于复杂的数据流，使用LLM进行深度分析
   * 识别隐式数据流和复杂的污点传播路径
   */
  private async enhanceTaintAnalysisWithLLM(
    code: string,
    sources: DataFlow['sources'],
    sinks: DataFlow['sinks'],
    taintPaths: DataFlow['taintPaths']
  ): Promise<void> {
    if (!this.llm || taintPaths.length === 0) return;

    try {
      const sourcesList = sources.map(s => `${s.type} at line ${s.location.line}`);
      const sinksList = sinks.map(s => `${s.type} at line ${s.location.line}`);

      const messages = this.llm.generateTaintAnalysisPrompt(
        code.length > 4000 ? code.substring(0, 4000) : code,
        sourcesList,
        sinksList
      );

      const response = await this.llm.chat(messages, {
        temperature: 0.2,
        maxTokens: 2000,
      });

      // 尝试解析LLM返回的额外污点路径
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const llmResult = JSON.parse(jsonMatch[0]) as { taintPaths?: Array<any> };

        if (Array.isArray(llmResult.taintPaths)) {
          logger.info(`LLM identified ${llmResult.taintPaths.length} additional taint paths`);

          // 将LLM发现的路径添加到结果中（去重）
          llmResult.taintPaths.forEach((path: any) => {
            const exists = taintPaths.some(
              p => p.source.location.line === path.source?.location?.line &&
                   p.sink.location.line === path.sink?.location?.line
            );

            if (!exists && path.source && path.sink) {
              taintPaths.push({
                source: path.source,
                sink: path.sink,
                path: path.path || [],
              });
            }
          });
        }
      }
    } catch (error) {
      logger.debug('LLM taint analysis enhancement failed', error);
    }
  }

  /**
   * 检查函数参数是否被污染
   */
  private checkTaintedArguments(
    args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>,
    taintMap: Map<string, { sourceType: string; sourceLine: number }>,
    taintPaths: DataFlow['taintPaths'],
    _funcName: string,
    line: number
  ): void {
    args.forEach((arg) => {
      if (t.isIdentifier(arg) && taintMap.has(arg.name)) {
        const taintInfo = taintMap.get(arg.name)!;
        taintPaths.push({
          source: {
            type: taintInfo.sourceType as DataFlow['sources'][0]['type'],
            location: { file: 'current', line: taintInfo.sourceLine },
          },
          sink: {
            type: 'eval',
            location: { file: 'current', line },
          },
          path: [
            { file: 'current', line: taintInfo.sourceLine },
            { file: 'current', line },
          ],
        });
      }
    });
  }

  /**
   * 识别安全风险 - 增强版
   *
   * 基于OWASP Top 10和CWE标准进行全面的安全风险检测
   * 结合静态分析和AI分析结果
   */
  private identifySecurityRisks(code: string, aiAnalysis: Record<string, unknown>): SecurityRisk[] {
    const risks: SecurityRisk[] = [];

    // 从AI分析中提取风险
    if (Array.isArray(aiAnalysis.securityRisks)) {
      aiAnalysis.securityRisks.forEach((risk: unknown) => {
        if (typeof risk === 'object' && risk !== null) {
          const r = risk as Record<string, unknown>;
          risks.push({
            type: (r.type as SecurityRisk['type']) || 'other',
            severity: (r.severity as SecurityRisk['severity']) || 'low',
            location: { file: 'current', line: (r.location as any)?.line || 0 },
            description: (r.description as string) || '',
            recommendation: (r.recommendation as string) || '',
          });
        }
      });
    }

    // 基于规则的静态检测 - 增强版
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      traverse(ast, {
        // 1. XSS风险检测
        AssignmentExpression(path) {
          const left = path.node.left;
          const line = path.node.loc?.start.line || 0;

          if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
            const propName = left.property.name;

            // innerHTML/outerHTML赋值
            if (['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(propName)) {
              risks.push({
                type: 'xss',
                severity: 'high',
                location: { file: 'current', line },
                description: `Potential XSS vulnerability: Direct assignment to ${propName} without sanitization`,
                recommendation: 'Use textContent for plain text, or DOMPurify.sanitize() for HTML content',
              });
            }

            // document.write
            if (propName === 'write' && t.isIdentifier(left.object) && left.object.name === 'document') {
              risks.push({
                type: 'xss',
                severity: 'high',
                location: { file: 'current', line },
                description: 'Dangerous use of document.write() which can lead to XSS',
                recommendation: 'Use modern DOM manipulation methods instead',
              });
            }
          }
        },

        // 2. 代码注入风险
        CallExpression(path) {
          const callee = path.node.callee;
          const line = path.node.loc?.start.line || 0;

          // eval(), Function(), setTimeout/setInterval with string
          if (t.isIdentifier(callee)) {
            if (callee.name === 'eval') {
              risks.push({
                type: 'other',
                severity: 'critical',
                location: { file: 'current', line },
                description: 'Critical: Use of eval() allows arbitrary code execution',
                recommendation: 'Refactor to avoid eval(). Use JSON.parse() for data, or proper function calls',
              });
            }

            if (callee.name === 'Function') {
              risks.push({
                type: 'other',
                severity: 'critical',
                location: { file: 'current', line },
                description: 'Critical: Function constructor allows code injection',
                recommendation: 'Use regular function declarations or arrow functions',
              });
            }

            // setTimeout/setInterval with string argument
            if (['setTimeout', 'setInterval'].includes(callee.name)) {
              const firstArg = path.node.arguments[0];
              if (t.isStringLiteral(firstArg) || (t.isIdentifier(firstArg) && firstArg.name !== 'function')) {
                risks.push({
                  type: 'other',
                  severity: 'medium',
                  location: { file: 'current', line },
                  description: `${callee.name}() with string argument can lead to code injection`,
                  recommendation: `Use ${callee.name}() with function reference instead of string`,
                });
              }
            }
          }

          // 3. SQL注入风险检测（字符串拼接查询）
          if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
            const methodName = callee.property.name;

            // 数据库查询方法
            if (['query', 'execute', 'exec', 'run'].includes(methodName)) {
              const firstArg = path.node.arguments[0];

              // 检查是否使用字符串拼接
              if (t.isBinaryExpression(firstArg) || t.isTemplateLiteral(firstArg)) {
                risks.push({
                  type: 'sql-injection',
                  severity: 'critical',
                  location: { file: 'current', line },
                  description: 'Potential SQL injection: Query built with string concatenation',
                  recommendation: 'Use parameterized queries or prepared statements',
                });
              }
            }
          }
        },

        // 4. 不安全的随机数生成
        MemberExpression(path) {
          const obj = path.node.object;
          const prop = path.node.property;
          const line = path.node.loc?.start.line || 0;

          if (t.isIdentifier(obj) && obj.name === 'Math' &&
              t.isIdentifier(prop) && prop.name === 'random') {
            // 检查是否用于安全相关场景（通过上下文判断）
            const parent = path.parent;
            if (t.isCallExpression(parent) || t.isBinaryExpression(parent)) {
              risks.push({
                type: 'other',
                severity: 'medium',
                location: { file: 'current', line },
                description: 'Math.random() is not cryptographically secure',
                recommendation: 'Use crypto.getRandomValues() or crypto.randomBytes() for security-sensitive operations',
              });
            }
          }
        },

        // 5. 硬编码敏感信息检测
        VariableDeclarator(path) {
          const id = path.node.id;
          const init = path.node.init;
          const line = path.node.loc?.start.line || 0;

          if (t.isIdentifier(id) && t.isStringLiteral(init)) {
            const varName = id.name.toLowerCase();
            const value = init.value;

            // 检测可能的密钥、密码、token
            const sensitivePatterns = [
              { pattern: /(password|passwd|pwd)/i, type: 'password' },
              { pattern: /(api[_-]?key|apikey)/i, type: 'API key' },
              { pattern: /(secret|token|auth)/i, type: 'secret' },
              { pattern: /(private[_-]?key|privatekey)/i, type: 'private key' },
            ];

            for (const { pattern, type } of sensitivePatterns) {
              if (pattern.test(varName) && value.length > 8) {
                risks.push({
                  type: 'other',
                  severity: 'critical',
                  location: { file: 'current', line },
                  description: `Hardcoded ${type} detected in source code`,
                  recommendation: `Store ${type} in environment variables or secure configuration`,
                });
                break;
              }
            }
          }
        },
      });
    } catch (error) {
      logger.warn('Static security analysis failed', error);
    }

    // 去重（基于type和line）
    const uniqueRisks = risks.filter((risk, index, self) =>
      index === self.findIndex((r) => r.type === risk.type && r.location.line === risk.location.line)
    );

    return uniqueRisks;
  }

  /**
   * 计算代码质量评分 - 增强版
   *
   * 综合多个维度计算代码质量:
   * - 安全性 (Security)
   * - 复杂度 (Complexity)
   * - 可维护性 (Maintainability)
   * - 代码异味 (Code Smells)
   * - AI评估 (AI Assessment)
   */
  private calculateQualityScore(
    structure: CodeStructure,
    securityRisks: SecurityRisk[],
    aiAnalysis: Record<string, unknown>,
    complexityMetrics?: {
      cyclomaticComplexity: number;
      cognitiveComplexity: number;
      maintainabilityIndex: number;
    },
    antiPatterns?: Array<{ severity: string }>
  ): number {
    let score = 100;

    // 1. 安全风险扣分 (权重: 40%)
    let securityScore = 100;
    securityRisks.forEach((risk) => {
      if (risk.severity === 'critical') securityScore -= 20;
      else if (risk.severity === 'high') securityScore -= 10;
      else if (risk.severity === 'medium') securityScore -= 5;
      else securityScore -= 2;
    });
    securityScore = Math.max(0, securityScore);

    // 2. 代码复杂度扣分 (权重: 25%)
    let complexityScore = 100;
    if (complexityMetrics) {
      // 圈复杂度评分
      if (complexityMetrics.cyclomaticComplexity > 20) complexityScore -= 30;
      else if (complexityMetrics.cyclomaticComplexity > 10) complexityScore -= 15;
      else if (complexityMetrics.cyclomaticComplexity > 5) complexityScore -= 5;

      // 认知复杂度评分
      if (complexityMetrics.cognitiveComplexity > 15) complexityScore -= 20;
      else if (complexityMetrics.cognitiveComplexity > 10) complexityScore -= 10;
    } else {
      // 回退到简单的平均复杂度计算
      const avgComplexity =
        structure.functions.reduce((sum, fn) => sum + fn.complexity, 0) / (structure.functions.length || 1);
      if (avgComplexity > 10) complexityScore -= 20;
      else if (avgComplexity > 5) complexityScore -= 10;
    }
    complexityScore = Math.max(0, complexityScore);

    // 3. 可维护性评分 (权重: 20%)
    let maintainabilityScore = complexityMetrics?.maintainabilityIndex || 70;

    // 4. 代码异味扣分 (权重: 15%)
    let codeSmellScore = 100;
    if (antiPatterns) {
      antiPatterns.forEach((pattern) => {
        if (pattern.severity === 'high') codeSmellScore -= 10;
        else if (pattern.severity === 'medium') codeSmellScore -= 5;
        else codeSmellScore -= 2;
      });
    }
    codeSmellScore = Math.max(0, codeSmellScore);

    // 5. AI评分 (如果可用)
    let aiScore = 70; // 默认值
    if (typeof aiAnalysis.qualityScore === 'number') {
      aiScore = aiAnalysis.qualityScore;
    }

    // 加权平均
    score =
      securityScore * 0.40 +
      complexityScore * 0.25 +
      maintainabilityScore * 0.20 +
      codeSmellScore * 0.15;

    // 与AI评分取平均（如果AI评分可用）
    if (typeof aiAnalysis.qualityScore === 'number') {
      score = (score + aiScore) / 2;
    }

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * 检查是否为Sanitizer函数调用
   * @param node - AST节点
   * @param sanitizers - Sanitizer函数集合
   * @returns 是否为Sanitizer
   */
  private checkSanitizer(
    node: t.CallExpression,
    sanitizers: Set<string>
  ): boolean {
    const { callee } = node;

    // 简单函数调用: encodeURIComponent()
    if (t.isIdentifier(callee)) {
      return sanitizers.has(callee.name);
    }

    // 成员表达式: DOMPurify.sanitize(), validator.escape()
    if (t.isMemberExpression(callee)) {
      const fullName = this.getMemberExpressionName(callee);
      return sanitizers.has(fullName);
    }

    return false;
  }

  /**
   * 获取成员表达式的完整名称
   * @param node - 成员表达式节点
   * @returns 完整名称，如 "DOMPurify.sanitize"
   */
  private getMemberExpressionName(node: t.MemberExpression): string {
    const parts: string[] = [];

    let current: t.Expression | t.PrivateName = node;
    while (t.isMemberExpression(current)) {
      if (t.isIdentifier(current.property)) {
        parts.unshift(current.property.name);
      }
      current = current.object;
    }

    if (t.isIdentifier(current)) {
      parts.unshift(current.name);
    }

    return parts.join('.');
  }

  /**
   * 检测代码模式和反模式
   *
   * 识别常见的设计模式和代码异味
   * 基于业界最佳实践和代码质量标准
   */
  private detectCodePatterns(code: string): {
    patterns: Array<{ name: string; location: number; description: string }>;
    antiPatterns: Array<{ name: string; location: number; severity: string; recommendation: string }>;
  } {
    const patterns: Array<{ name: string; location: number; description: string }> = [];
    const antiPatterns: Array<{ name: string; location: number; severity: string; recommendation: string }> = [];

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      traverse(ast, {
        // 检测单例模式
        VariableDeclarator(path) {
          const init = path.node.init;
          if (t.isCallExpression(init) &&
              t.isFunctionExpression(init.callee) &&
              init.callee.body.body.some(stmt =>
                t.isReturnStatement(stmt) &&
                t.isObjectExpression(stmt.argument)
              )) {
            patterns.push({
              name: 'Singleton Pattern',
              location: path.node.loc?.start.line || 0,
              description: 'IIFE returning object (Singleton pattern)',
            });
          }
        },

        // 检测观察者模式
        ClassDeclaration(path) {
          const methods = path.node.body.body.filter(m => t.isClassMethod(m));
          const methodNames = methods.map(m =>
            t.isClassMethod(m) && t.isIdentifier(m.key) ? m.key.name : ''
          );

          if (methodNames.includes('subscribe') &&
              methodNames.includes('unsubscribe') &&
              methodNames.includes('notify')) {
            patterns.push({
              name: 'Observer Pattern',
              location: path.node.loc?.start.line || 0,
              description: 'Class with subscribe/unsubscribe/notify methods',
            });
          }
        },

        // 反模式: 过长函数
        FunctionDeclaration(path) {
          const loc = path.node.loc;
          if (loc) {
            const lines = loc.end.line - loc.start.line;
            if (lines > 50) {
              antiPatterns.push({
                name: 'Long Function',
                location: loc.start.line,
                severity: 'medium',
                recommendation: `Function is ${lines} lines long. Consider breaking it into smaller functions (max 50 lines)`,
              });
            }
          }
        },

        // 反模式: 深层嵌套
        IfStatement(path) {
          let depth = 0;
          let current: typeof path.parentPath | null = path.parentPath;

          while (current) {
            if (current.isIfStatement() ||
                current.isForStatement() ||
                current.isWhileStatement()) {
              depth++;
            }
            current = current.parentPath;
          }

          if (depth > 3) {
            antiPatterns.push({
              name: 'Deep Nesting',
              location: path.node.loc?.start.line || 0,
              severity: 'medium',
              recommendation: `Nesting depth is ${depth}. Consider extracting to separate functions or using early returns`,
            });
          }
        },

        // 反模式: 魔法数字
        NumericLiteral(path) {
          const value = path.node.value;
          const parent = path.parent;

          // 忽略常见的数字 (0, 1, -1, 2, 10, 100, 1000)
          const commonNumbers = [0, 1, -1, 2, 10, 100, 1000];
          if (commonNumbers.includes(value)) return;

          // 忽略数组索引
          if (t.isMemberExpression(parent) && parent.property === path.node) return;

          // 忽略函数参数默认值
          if (t.isAssignmentPattern(parent)) return;

          antiPatterns.push({
            name: 'Magic Number',
            location: path.node.loc?.start.line || 0,
            severity: 'low',
            recommendation: `Replace magic number ${value} with a named constant`,
          });
        },

        // 反模式: 空catch块
        CatchClause(path) {
          const body = path.node.body.body;
          if (body.length === 0) {
            antiPatterns.push({
              name: 'Empty Catch Block',
              location: path.node.loc?.start.line || 0,
              severity: 'high',
              recommendation: 'Empty catch block swallows errors. Add proper error handling or logging',
            });
          }
        },

        // 反模式: 使用var而非let/const
        VariableDeclaration(path) {
          if (path.node.kind === 'var') {
            antiPatterns.push({
              name: 'Use of var',
              location: path.node.loc?.start.line || 0,
              severity: 'low',
              recommendation: 'Use let or const instead of var for better scoping',
            });
          }
        },
      });

      // 重复代码检测 - 基于AST结构相似度
      const duplicates = this.detectDuplicateCode(ast);
      duplicates.forEach(dup => {
        antiPatterns.push({
          name: 'Duplicate Code',
          location: dup.location,
          severity: 'medium',
          recommendation: `Duplicate code found at lines ${dup.location} and ${dup.duplicateLocation}. Extract into a reusable function.`,
        });
      });
    } catch (error) {
      logger.warn('Code pattern detection failed', error);
    }

    return { patterns, antiPatterns };
  }

  /**
   * 分析代码复杂度指标
   *
   * 计算多种复杂度指标:
   * - 圈复杂度 (Cyclomatic Complexity)
   * - 认知复杂度 (Cognitive Complexity)
   * - 维护性指数 (Maintainability Index)
   */
  private analyzeComplexityMetrics(code: string): {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    maintainabilityIndex: number;
    halsteadMetrics: {
      vocabulary: number;
      length: number;
      difficulty: number;
      effort: number;
    };
  } {
    let cyclomaticComplexity = 1;
    let cognitiveComplexity = 0;
    let operators = 0;
    let operands = 0;
    const uniqueOperators = new Set<string>();
    const uniqueOperands = new Set<string>();

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let nestingLevel = 0;

      traverse(ast, {
        // 圈复杂度
        IfStatement() { cyclomaticComplexity++; },
        SwitchCase() { cyclomaticComplexity++; },
        ForStatement() { cyclomaticComplexity++; },
        WhileStatement() { cyclomaticComplexity++; },
        DoWhileStatement() { cyclomaticComplexity++; },
        ConditionalExpression() { cyclomaticComplexity++; },
        LogicalExpression(path) {
          if (path.node.operator === '&&' || path.node.operator === '||') {
            cyclomaticComplexity++;
          }
        },
        CatchClause() { cyclomaticComplexity++; },

        // 认知复杂度（考虑嵌套）
        'IfStatement|ForStatement|WhileStatement|DoWhileStatement': {
          enter() {
            nestingLevel++;
            cognitiveComplexity += nestingLevel;
          },
          exit() {
            nestingLevel--;
          },
        },

        // Halstead指标
        BinaryExpression(path) {
          operators++;
          uniqueOperators.add(path.node.operator);
        },
        UnaryExpression(path) {
          operators++;
          uniqueOperators.add(path.node.operator);
        },
        Identifier(path) {
          operands++;
          uniqueOperands.add(path.node.name);
        },
        NumericLiteral(path) {
          operands++;
          uniqueOperands.add(String(path.node.value));
        },
        StringLiteral(path) {
          operands++;
          uniqueOperands.add(path.node.value);
        },
      });
    } catch (error) {
      logger.warn('Complexity metrics calculation failed', error);
    }

    // Halstead指标计算
    const n1 = uniqueOperators.size; // 唯一操作符数
    const n2 = uniqueOperands.size;  // 唯一操作数数
    const N1 = operators;             // 总操作符数
    const N2 = operands;              // 总操作数数

    const vocabulary = n1 + n2;
    const length = N1 + N2;
    const difficulty = (n1 / 2) * (N2 / (n2 || 1));
    const effort = difficulty * length;

    // 维护性指数 (Maintainability Index)
    // MI = 171 - 5.2 * ln(V) - 0.23 * G - 16.2 * ln(LOC)
    const volume = length * Math.log2(vocabulary || 1);
    const loc = code.split('\n').length;
    const maintainabilityIndex = Math.max(0,
      171 - 5.2 * Math.log(volume || 1) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(loc)
    );

    return {
      cyclomaticComplexity,
      cognitiveComplexity,
      maintainabilityIndex: Math.round(maintainabilityIndex),
      halsteadMetrics: {
        vocabulary,
        length,
        difficulty: Math.round(difficulty * 100) / 100,
        effort: Math.round(effort),
      },
    };
  }

  /**
   * 检测重复代码 - 基于AST结构相似度
   *
   * 使用AST结构哈希和相似度算法检测重复代码块
   * 算法参考:
   * - Token-based Clone Detection
   * - AST-based Clone Detection (Type-1, Type-2, Type-3 clones)
   *
   * Type-1: 完全相同的代码（除了空格和注释）
   * Type-2: 结构相同但变量名不同
   * Type-3: 结构相似但有小的修改
   */
  private detectDuplicateCode(ast: t.File): Array<{
    location: number;
    duplicateLocation: number;
    similarity: number;
  }> {
    const duplicates: Array<{ location: number; duplicateLocation: number; similarity: number }> = [];
    const codeBlocks: Array<{
      node: t.Node;
      hash: string;
      location: number;
      normalizedCode: string;
    }> = [];

    try {
      const self = this;

      // 收集所有代码块（函数、类方法、块语句）
      traverse(ast, {
        FunctionDeclaration(path) {
          const hash = self.computeASTHash(path.node);
          const normalized = self.normalizeCode(path.node);
          codeBlocks.push({
            node: path.node,
            hash,
            location: path.node.loc?.start.line || 0,
            normalizedCode: normalized,
          });
        },

        FunctionExpression(path) {
          const hash = self.computeASTHash(path.node);
          const normalized = self.normalizeCode(path.node);
          codeBlocks.push({
            node: path.node,
            hash,
            location: path.node.loc?.start.line || 0,
            normalizedCode: normalized,
          });
        },

        ArrowFunctionExpression(path) {
          const hash = self.computeASTHash(path.node);
          const normalized = self.normalizeCode(path.node);
          codeBlocks.push({
            node: path.node,
            hash,
            location: path.node.loc?.start.line || 0,
            normalizedCode: normalized,
          });
        },

        ClassMethod(path) {
          const hash = self.computeASTHash(path.node);
          const normalized = self.normalizeCode(path.node);
          codeBlocks.push({
            node: path.node,
            hash,
            location: path.node.loc?.start.line || 0,
            normalizedCode: normalized,
          });
        },
      });

      // 比较所有代码块，查找重复
      for (let i = 0; i < codeBlocks.length; i++) {
        for (let j = i + 1; j < codeBlocks.length; j++) {
          const block1 = codeBlocks[i]!;
          const block2 = codeBlocks[j]!;

          // Type-1 克隆: 完全相同的哈希
          if (block1.hash === block2.hash) {
            duplicates.push({
              location: block1.location,
              duplicateLocation: block2.location,
              similarity: 1.0,
            });
            continue;
          }

          // Type-2/Type-3 克隆: 计算相似度
          const similarity = this.calculateCodeSimilarity(
            block1.normalizedCode,
            block2.normalizedCode
          );

          // 相似度阈值: 0.85 (85%以上认为是重复代码)
          if (similarity >= 0.85) {
            duplicates.push({
              location: block1.location,
              duplicateLocation: block2.location,
              similarity,
            });
          }
        }
      }
    } catch (error) {
      logger.debug('Duplicate code detection failed', error);
    }

    return duplicates;
  }

  /**
   * 计算AST节点的哈希值
   *
   * 用于Type-1克隆检测（完全相同的代码）
   * 忽略位置信息和注释
   */
  private computeASTHash(node: t.Node): string {
    // 简化的哈希计算：将AST转换为规范化的字符串
    const normalized = JSON.stringify(node, (key, value) => {
      // 忽略位置信息
      if (['loc', 'start', 'end', 'range'].includes(key)) {
        return undefined;
      }
      // 忽略注释
      if (key === 'comments' || key === 'leadingComments' || key === 'trailingComments') {
        return undefined;
      }
      return value;
    });

    // 使用简单的字符串哈希（实际应该用更好的哈希算法如MD5/SHA256）
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  /**
   * 规范化代码 - 用于Type-2克隆检测
   *
   * 将变量名、函数名等标识符替换为占位符
   * 保留代码结构
   */
  private normalizeCode(node: t.Node): string {
    let identifierCounter = 0;
    const identifierMap = new Map<string, string>();

    const clonedNode = t.cloneNode(node, true, false);

    traverse(t.file(t.program([clonedNode as t.Statement])), {
      Identifier(path) {
        const name = path.node.name;

        // 跳过保留字和内置对象
        const reserved = ['console', 'window', 'document', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number'];
        if (reserved.includes(name)) return;

        // 为每个唯一标识符分配一个规范化的名称
        if (!identifierMap.has(name)) {
          identifierMap.set(name, `VAR_${identifierCounter++}`);
        }
        path.node.name = identifierMap.get(name)!;
      },

      // 规范化字符串字面量
      StringLiteral(path) {
        path.node.value = 'STRING';
      },

      // 规范化数字字面量
      NumericLiteral(path) {
        path.node.value = 0;
      },
    });

    return JSON.stringify(clonedNode);
  }

  /**
   * 计算两段代码的相似度
   *
   * 使用Levenshtein距离算法计算字符串相似度
   * 返回值: 0.0 (完全不同) 到 1.0 (完全相同)
   */
  private calculateCodeSimilarity(code1: string, code2: string): number {
    // Levenshtein距离算法
    const len1 = code1.length;
    const len2 = code2.length;

    // 优化：如果长度差异太大，直接返回低相似度
    if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.3) {
      return 0;
    }

    // 动态规划矩阵 - 使用Array.from确保类型安全
    const matrix: number[][] = Array.from({ length: len1 + 1 }, () =>
      Array.from({ length: len2 + 1 }, () => 0)
    );

    // 初始化第一行和第一列
    for (let i = 0; i <= len1; i++) {
      matrix[i]![0] = i;
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0]![j] = j;
    }

    // 填充矩阵
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = code1[i - 1] === code2[j - 1] ? 0 : 1;
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j]! + 1,      // 删除
          matrix[i]![j - 1]! + 1,      // 插入
          matrix[i - 1]![j - 1]! + cost // 替换
        );
      }
    }

    const distance = matrix[len1]![len2]!;
    const maxLen = Math.max(len1, len2);

    // 相似度 = 1 - (编辑距离 / 最大长度)
    return 1 - (distance / maxLen);
  }
}

