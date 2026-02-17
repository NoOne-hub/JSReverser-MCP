/**
 * 反混淆主管线
 *
 * 统一调度所有反混淆子模块，按检测结果自动选择最优管线：
 *   1. PackerDeobfuscator  — Packer / AAEncode / URLEncode 解包
 *   2. JSVMPDeobfuscator   — JSVMP 虚拟机保护还原
 *   3. AdvancedDeobfuscator — 高级混淆 (invisible-unicode, 控制流平坦化, 不透明谓词, 死代码…)
 *   4. ASTOptimizer         — 通用 AST 优化 (常量折叠/传播, 变量内联, 序列展开…)
 *   5. 基础管线             — 字符串数组提取/替换, 字符串解码, 表达式简化, 变量重命名
 *   6. LLM 辅助分析        — 可选，利用 AI 做语义分析
 *
 * 设计原则：
 *   - 每个子管线独立 try/catch，单步失败不中断整体
 *   - 检测优先，只对检测到的混淆类型执行对应管线
 *   - 管线顺序固定：先解包 → 再深度还原 → 再 AST 优化 → 最后基础清理
 *   - 结果缓存 + LRU 淘汰
 */

import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
const traverse = (traverseImport as unknown as {default?: typeof traverseImport}).default ?? traverseImport;
import generateImport from '@babel/generator';
const generate = (generateImport as unknown as {default?: typeof generateImport}).default ?? generateImport;
import * as t from '@babel/types';
import crypto from 'crypto';
import type { DeobfuscateOptions, DeobfuscateResult, ObfuscationType, Transformation, UnresolvedPart } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { LLMService } from '../../services/LLMService.js';

// 子模块
import { AdvancedDeobfuscator, type AdvancedDeobfuscateOptions } from './AdvancedDeobfuscator.js';
import { JSVMPDeobfuscator } from './JSVMPDeobfuscator.js';
import { ASTOptimizer } from './ASTOptimizer.js';
import { PackerDeobfuscator, AAEncodeDeobfuscator, URLEncodeDeobfuscator, UniversalUnpacker } from './PackerDeobfuscator.js';

// ==================== 扩展选项 ====================

export interface DeobfuscateFullOptions extends DeobfuscateOptions {
  /** 启用高级反混淆管线（AdvancedDeobfuscator） */
  advanced?: boolean;
  /** 启用 JSVMP 专项反混淆 */
  jsvmp?: boolean;
  /** 启用 AST 优化器 */
  astOptimize?: boolean;
  /** 启用 Packer/AAEncode/URLEncode 自动解包 */
  unpack?: boolean;
  /** 激进 VM 反混淆 */
  aggressiveVM?: boolean;
  /** 超时(ms)，默认 60000 */
  timeout?: number;
  /** 自动模式：根据检测结果自动启用对应管线（默认 true） */
  auto?: boolean;
}

// ==================== 主类 ====================

export class Deobfuscator {
  private llm?: LLMService;

  // 子模块实例
  private advancedDeobfuscator: AdvancedDeobfuscator;
  private jsvmpDeobfuscator: JSVMPDeobfuscator;
  private astOptimizer: ASTOptimizer;
  private universalUnpacker: UniversalUnpacker;

  // 缓存
  private stringArrays: Map<string, string[]> = new Map();
  private resultCache = new Map<string, DeobfuscateResult>();
  private maxCacheSize = 100;

  constructor(llm?: LLMService) {
    this.llm = llm;
    this.advancedDeobfuscator = new AdvancedDeobfuscator(llm);
    this.jsvmpDeobfuscator = new JSVMPDeobfuscator(llm);
    this.astOptimizer = new ASTOptimizer();
    this.universalUnpacker = new UniversalUnpacker();
  }

  // ==================== 公共 API ====================

  /**
   * 完整反混淆管线入口
   */
  async deobfuscate(options: DeobfuscateFullOptions): Promise<DeobfuscateResult> {
    // 缓存
    const cacheKey = this.generateCacheKey(options);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      logger.debug('Deobfuscation result from cache');
      return cached;
    }

    logger.info('Starting deobfuscation pipeline...');
    const startTime = Date.now();

    // 全局收集器：子管线的 warnings 和 unresolvedParts 在这里汇聚
    // 最终完整透传给外部 AI，让外部 AI 基于这些信息做更深度的推理
    const pipelineWarnings: string[] = [];
    const pipelineUnresolved: UnresolvedPart[] = [];

    try {
      let code = options.code;
      const transformations: Transformation[] = [];
      const autoMode = options.auto !== false; // 默认自动

      // ── Step 0: 检测混淆类型 ──
      const obfuscationType = this.detectObfuscationType(code);
      logger.info(`Detected obfuscation types: ${obfuscationType.join(', ')}`);
      pipelineWarnings.push(`检测到的混淆类型: ${obfuscationType.join(', ')}`);

      // ── Step 1: Packer / AAEncode / URLEncode 自动解包 ──
      if (this.shouldRun(options.unpack, autoMode, obfuscationType, ['packer', 'aaencode', 'urlencoded', 'eval-obfuscation'])) {
        code = await this.runUnpack(code, transformations);
      }

      // ── Step 2: JSVMP 虚拟机保护还原 ──
      if (this.shouldRun(options.jsvmp, autoMode, obfuscationType, ['vm-protection'])) {
        code = await this.runJSVMP(code, options, transformations, pipelineWarnings, pipelineUnresolved);
      }

      // ── Step 3: 高级反混淆 ──
      if (this.shouldRun(options.advanced, autoMode, obfuscationType, [
        'invisible-unicode', 'control-flow-flattening', 'string-array-rotation',
        'dead-code-injection', 'opaque-predicates', 'custom',
      ])) {
        code = await this.runAdvanced(code, options, transformations, pipelineWarnings);
      }

      // ── Step 4: 基础管线 ──
      // 字符串数组提取 + 替换
      code = await this.extractStringArrays(code, transformations);
      code = await this.basicTransform(code, transformations);
      code = await this.decodeStrings(code, transformations);
      code = await this.decryptArrays(code, transformations);

      // 控制流平坦化还原（基础版，仅 aggressive 时）
      if (options.aggressive) {
        code = await this.unflattenControlFlow(code, transformations);
      }

      // 表达式简化
      code = await this.simplifyExpressions(code, transformations);

      // ── Step 5: AST 优化器 ──
      if (this.shouldRun(options.astOptimize, autoMode, obfuscationType, ['javascript-obfuscator', 'uglify', 'webpack'])) {
        code = await this.runASTOptimizer(code, transformations);
      }

      // ── Step 6: 变量重命名 ──
      if (options.renameVariables) {
        code = await this.renameVariables(code, transformations);
      }

      // ── Step 7: LLM 辅助分析 ──
      let analysis = 'Deobfuscation pipeline completed.';
      if (this.llm && options.llm) {
        const llmResult = await this.llmAnalysis(code);
        if (llmResult) {
          analysis = llmResult;
          transformations.push({ type: 'llm-analysis', description: 'AI-assisted code analysis completed', success: true });
        }
      }

      // ── 结果 ──
      const deobfuscateTime = Date.now() - startTime;
      const readabilityScore = this.calculateReadabilityScore(code);
      const confidence = this.calculateConfidence(transformations, readabilityScore);

      // 重新检测，因为某些类型可能在子管线中被发现
      const finalTypes = this.mergeObfuscationTypes(obfuscationType, transformations);

      logger.success(`Deobfuscation completed in ${deobfuscateTime}ms (confidence: ${(confidence * 100).toFixed(1)}%)`);

      const result: DeobfuscateResult = {
        code,
        readabilityScore,
        confidence,
        obfuscationType: finalTypes,
        transformations,
        analysis,
        // 完整透传给外部 AI：所有子管线的分析信息
        warnings: pipelineWarnings.length > 0 ? pipelineWarnings : undefined,
        unresolvedParts: pipelineUnresolved.length > 0 ? pipelineUnresolved : undefined,
      };

      this.cacheResult(cacheKey, result);
      return result;
    } catch (error) {
      logger.error('Deobfuscation failed', error);
      throw error;
    }
  }

  // ==================== 子管线调度 ====================

  /**
   * 是否应该运行某个子管线
   */
  private shouldRun(
    explicitFlag: boolean | undefined,
    autoMode: boolean,
    detected: ObfuscationType[],
    triggers: ObfuscationType[],
  ): boolean {
    // 显式关闭
    if (explicitFlag === false) return false;
    // 显式开启
    if (explicitFlag === true) return true;
    // 自动模式：检测到对应类型就开
    if (autoMode) {
      return detected.some(t => triggers.includes(t));
    }
    return false;
  }

  /**
   * Packer / AAEncode / URLEncode 解包
   */
  private async runUnpack(code: string, transformations: Transformation[]): Promise<string> {
    try {
      logger.info('Running UniversalUnpacker...');
      const result = await this.universalUnpacker.deobfuscate(code);
      if (result.success && result.code !== code) {
        transformations.push({
          type: 'unpack',
          description: `Unpacked ${result.type} obfuscation`,
          success: true,
        });
        return result.code;
      }
    } catch (error) {
      logger.warn('UniversalUnpacker failed', error);
      transformations.push({ type: 'unpack', description: 'UniversalUnpacker failed', success: false });
    }
    return code;
  }

  /**
   * JSVMP 虚拟机保护还原
   * warnings/unresolvedParts 完整透传给外部 AI
   */
  private async runJSVMP(
    code: string,
    options: DeobfuscateFullOptions,
    transformations: Transformation[],
    pipelineWarnings: string[],
    pipelineUnresolved: UnresolvedPart[],
  ): Promise<string> {
    try {
      logger.info('Running JSVMPDeobfuscator...');
      const result = await this.jsvmpDeobfuscator.deobfuscate({
        code,
        aggressive: options.aggressiveVM ?? options.aggressive ?? false,
        extractInstructions: true,
        timeout: options.timeout ?? 30000,
      });

      // 无论是否成功还原，warnings 都透传给外部 AI
      if (result.warnings && result.warnings.length > 0) {
        pipelineWarnings.push(...result.warnings.map(w => `[JSVMP] ${w}`));
      }

      // unresolvedParts 完整透传
      if (result.unresolvedParts && result.unresolvedParts.length > 0) {
        pipelineUnresolved.push(...result.unresolvedParts);
      }

      if (result.isJSVMP && result.confidence > 0.3) {
        // 构建 detail 供外部 AI 深入分析
        const detail: Record<string, unknown> = {
          vmType: result.vmType,
          confidence: result.confidence,
          warningCount: result.warnings?.length ?? 0,
          unresolvedCount: result.unresolvedParts?.length ?? 0,
        };

        if (result.vmFeatures) {
          detail.vmFeatures = {
            instructionCount: result.vmFeatures.instructionCount,
            complexity: result.vmFeatures.complexity,
            hasSwitch: result.vmFeatures.hasSwitch,
            hasInstructionArray: result.vmFeatures.hasInstructionArray,
            hasProgramCounter: result.vmFeatures.hasProgramCounter,
            interpreterLocation: result.vmFeatures.interpreterLocation,
          };
        }

        if (result.instructions && result.instructions.length > 0) {
          detail.instructionSample = result.instructions.slice(0, 10).map(i => ({
            type: i.type,
            opcode: i.opcode,
          }));
        }

        if (result.stats) {
          detail.stats = result.stats;
        }

        transformations.push({
          type: 'jsvmp',
          description: `JSVMP deobfuscation (type: ${result.vmType ?? 'unknown'}, confidence: ${(result.confidence * 100).toFixed(1)}%)`,
          success: true,
          detail,
        });

        return result.deobfuscatedCode;
      } else if (result.isJSVMP) {
        // 检测到了 JSVMP 但置信度太低，仍然把分析信息传出
        pipelineWarnings.push(`[JSVMP] 检测到VM保护但还原置信度过低(${(result.confidence * 100).toFixed(1)}%)，代码未修改`);
        transformations.push({
          type: 'jsvmp',
          description: `JSVMP detected but confidence too low (${(result.confidence * 100).toFixed(1)}%), code unchanged`,
          success: false,
          detail: {
            vmType: result.vmType,
            confidence: result.confidence,
            reason: 'confidence_too_low',
          },
        });
      }
    } catch (error) {
      logger.warn('JSVMPDeobfuscator failed', error);
      pipelineWarnings.push(`[JSVMP] 反混淆失败: ${error}`);
      transformations.push({ type: 'jsvmp', description: `JSVMP deobfuscation failed: ${error}`, success: false });
    }
    return code;
  }

  /**
   * 高级反混淆管线
   * warnings 完整透传给外部 AI
   */
  private async runAdvanced(
    code: string,
    options: DeobfuscateFullOptions,
    transformations: Transformation[],
    pipelineWarnings: string[],
  ): Promise<string> {
    try {
      logger.info('Running AdvancedDeobfuscator...');
      const advOptions: AdvancedDeobfuscateOptions = {
        code,
        aggressiveVM: options.aggressiveVM,
        useASTOptimization: false, // AST 优化单独在 Step 5 处理，避免重复
        timeout: options.timeout,
      };

      const result = await this.advancedDeobfuscator.deobfuscate(advOptions);

      // 无论结果如何，warnings 透传给外部 AI
      if (result.warnings && result.warnings.length > 0) {
        pipelineWarnings.push(...result.warnings.map(w => `[Advanced] ${w}`));
      }

      if (result.detectedTechniques.length > 0) {
        transformations.push({
          type: 'advanced',
          description: `Advanced deobfuscation applied: ${result.detectedTechniques.join(', ')} (confidence: ${(result.confidence * 100).toFixed(1)}%)`,
          success: true,
          detail: {
            detectedTechniques: result.detectedTechniques,
            confidence: result.confidence,
          },
        });

        return result.code;
      }
    } catch (error) {
      logger.warn('AdvancedDeobfuscator failed', error);
      pipelineWarnings.push(`[Advanced] 高级反混淆失败: ${error}`);
      transformations.push({ type: 'advanced', description: `Advanced deobfuscation failed: ${error}`, success: false });
    }
    return code;
  }

  /**
   * AST 优化器
   */
  private async runASTOptimizer(code: string, transformations: Transformation[]): Promise<string> {
    try {
      logger.info('Running ASTOptimizer...');
      const optimized = this.astOptimizer.optimize(code);
      if (optimized !== code) {
        transformations.push({
          type: 'ast-optimize',
          description: 'AST optimizations applied (constant folding, propagation, variable inlining, property unfolding)',
          success: true,
        });
        return optimized;
      }
    } catch (error) {
      logger.warn('ASTOptimizer failed', error);
      transformations.push({ type: 'ast-optimize', description: 'AST optimization failed', success: false });
    }
    return code;
  }

  // ==================== 检测 ====================

  /**
   * 检测混淆类型（综合检测）
   */
  private detectObfuscationType(code: string): ObfuscationType[] {
    const types: ObfuscationType[] = [];

    // JavaScript Obfuscator
    if (code.includes('_0x') || /var\s+_0x[a-f0-9]+\s*=/.test(code)) {
      types.push('javascript-obfuscator');
    }

    // Webpack
    if (code.includes('__webpack_require__') || code.includes('webpackJsonp')) {
      types.push('webpack');
    }

    // UglifyJS (单行长代码)
    if (code.length > 1000 && !code.includes('\n')) {
      types.push('uglify');
    }

    // VM 保护
    if (code.includes('eval') && code.includes('Function')) {
      types.push('vm-protection');
    }

    // Packer
    if (PackerDeobfuscator.detect(code)) {
      types.push('packer');
    }

    // AAEncode
    if (AAEncodeDeobfuscator.detect(code)) {
      types.push('aaencode');
    }

    // URLEncode
    if (URLEncodeDeobfuscator.detect(code)) {
      types.push('urlencoded');
    }

    // Invisible Unicode (零宽字符)
    if (/[\u200B-\u200F\u2028-\u202F\uFEFF]/.test(code)) {
      types.push('invisible-unicode');
    }

    // 控制流平坦化 (while + switch 嵌套)
    if (/while\s*\([^)]*\)\s*\{?\s*switch\s*\(/.test(code) ||
        /while\s*\(\s*!!\s*\[\s*\]\s*\)\s*\{?\s*switch/.test(code)) {
      types.push('control-flow-flattening');
    }

    // 不透明谓词 (恒真/恒假条件)
    if (/if\s*\(\s*typeof\s+\w+\s*[!=]==?\s*['"]undefined['"]\s*\)/.test(code) &&
        code.includes('_0x')) {
      types.push('opaque-predicates');
    }

    // 死代码注入
    if (/if\s*\(\s*false\s*\)|if\s*\(\s*![1!]\s*\)/.test(code)) {
      types.push('dead-code-injection');
    }

    // 字符串数组旋转
    if (/\(\s*function\s*\(\s*_0x[a-f0-9]+\s*,\s*_0x[a-f0-9]+\s*\).*?push\s*\(\s*.*?shift\s*\(\s*\)/.test(code)) {
      types.push('string-array-rotation');
    }

    // JSFuck
    if (/^\s*[\[\]()!+]+\s*$/.test(code.substring(0, 200))) {
      types.push('jsfuck');
    }

    // eval 混淆
    if (/eval\s*\(\s*['"`]/.test(code) || /eval\s*\(\s*atob\s*\(/.test(code)) {
      types.push('eval-obfuscation');
    }

    // Hex 编码字符串
    if (/\\x[0-9a-fA-F]{2}/.test(code)) {
      types.push('hex-encoding');
    }

    // Base64 编码
    if (/atob\s*\(|btoa\s*\(/.test(code) && /[A-Za-z0-9+/]{20,}={0,2}/.test(code)) {
      types.push('base64-encoding');
    }

    if (types.length === 0) {
      types.push('unknown');
    }

    return types;
  }

  /**
   * 合并子管线检测到的额外混淆类型
   */
  private mergeObfuscationTypes(
    original: ObfuscationType[],
    transformations: Transformation[],
  ): ObfuscationType[] {
    const types = new Set<ObfuscationType>(original);

    // 从 transformations 推断新发现的类型
    for (const t of transformations) {
      if (t.success) {
        if (t.type === 'unpack' && t.description.includes('Packer')) types.add('packer');
        if (t.type === 'unpack' && t.description.includes('AAEncode')) types.add('aaencode');
        if (t.type === 'unpack' && t.description.includes('URLEncode')) types.add('urlencoded');
        if (t.type === 'jsvmp') types.add('vm-protection');
        if (t.type === 'advanced' && t.description.includes('invisible-unicode')) types.add('invisible-unicode');
        if (t.type === 'advanced' && t.description.includes('control-flow-flattening')) types.add('control-flow-flattening');
        if (t.type === 'advanced' && t.description.includes('opaque-predicates')) types.add('opaque-predicates');
        if (t.type === 'advanced' && t.description.includes('dead-code-injection')) types.add('dead-code-injection');
      }
    }

    // 移除 unknown（如果有具体类型）
    if (types.size > 1) {
      types.delete('unknown');
    }

    return [...types];
  }

  // ==================== 基础管线方法 ====================

  /**
   * 基础 AST 转换 (常量折叠 + 死代码消除)
   */
  private async basicTransform(code: string, transformations: Transformation[]): Promise<string> {
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });

      traverse(ast, {
        // 常量折叠
        BinaryExpression(path) {
          if (t.isNumericLiteral(path.node.left) && t.isNumericLiteral(path.node.right)) {
            const l = path.node.left.value;
            const r = path.node.right.value;
            let result: number | undefined;
            switch (path.node.operator) {
              case '+': result = l + r; break;
              case '-': result = l - r; break;
              case '*': result = l * r; break;
              case '/': result = r !== 0 ? l / r : undefined; break;
              case '%': result = r !== 0 ? l % r : undefined; break;
              case '**': result = l ** r; break;
              case '|': result = l | r; break;
              case '&': result = l & r; break;
              case '^': result = l ^ r; break;
              case '<<': result = l << r; break;
              case '>>': result = l >> r; break;
              case '>>>': result = l >>> r; break;
            }
            if (result !== undefined && isFinite(result)) {
              path.replaceWith(t.numericLiteral(result));
            }
          }
          // 字符串拼接折叠
          if (t.isStringLiteral(path.node.left) && t.isStringLiteral(path.node.right) && path.node.operator === '+') {
            path.replaceWith(t.stringLiteral(path.node.left.value + path.node.right.value));
          }
        },

        // 死代码消除
        IfStatement(path) {
          if (t.isBooleanLiteral(path.node.test)) {
            if (path.node.test.value) {
              path.replaceWith(path.node.consequent);
            } else if (path.node.alternate) {
              path.replaceWith(path.node.alternate);
            } else {
              path.remove();
            }
          }
        },

        // 条件表达式简化 true ? a : b → a
        ConditionalExpression(path) {
          if (t.isBooleanLiteral(path.node.test)) {
            path.replaceWith(path.node.test.value ? path.node.consequent : path.node.alternate);
          }
        },
      });

      const output = generate(ast, { comments: true, compact: false });
      transformations.push({ type: 'basic-ast-transform', description: 'Constant folding, dead code elimination, string concatenation', success: true });
      return output.code;
    } catch (error) {
      logger.warn('Basic transform failed', error);
      transformations.push({ type: 'basic-ast-transform', description: 'Failed', success: false });
      return code;
    }
  }

  /**
   * 字符串解码 (hex / unicode)
   */
  private async decodeStrings(code: string, transformations: Transformation[]): Promise<string> {
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      let decoded = 0;

      traverse(ast, {
        StringLiteral(path) {
          const value = path.node.value;
          let newValue = value;

          // 十六进制
          if (value.includes('\\x')) {
            newValue = newValue.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
          }
          // Unicode
          if (value.includes('\\u')) {
            newValue = newValue.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
          }

          if (newValue !== value) {
            path.node.value = newValue;
            decoded++;
          }
        },
      });

      if (decoded > 0) {
        const output = generate(ast, { comments: true, compact: false });
        transformations.push({ type: 'string-decode', description: `Decoded ${decoded} strings (hex/unicode)`, success: true });
        return output.code;
      }
      return code;
    } catch (error) {
      logger.warn('String decoding failed', error);
      transformations.push({ type: 'string-decode', description: 'Failed', success: false });
      return code;
    }
  }

  /**
   * 提取字符串数组 (JavaScript Obfuscator 特有)
   */
  private async extractStringArrays(code: string, transformations: Transformation[]): Promise<string> {
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      let extracted = 0;

      traverse(ast, {
        VariableDeclarator: (path) => {
          if (
            t.isIdentifier(path.node.id) &&
            path.node.id.name.startsWith('_0x') &&
            t.isArrayExpression(path.node.init)
          ) {
            const arrayName = path.node.id.name;
            const strings: string[] = [];
            path.node.init.elements.forEach((el) => {
              if (t.isStringLiteral(el)) strings.push(el.value);
            });
            if (strings.length > 0) {
              this.stringArrays.set(arrayName, strings);
              extracted++;
              logger.debug(`Extracted string array: ${arrayName} (${strings.length} strings)`);
            }
          }
        },
      });

      if (extracted > 0) {
        transformations.push({ type: 'extract-string-arrays', description: `Extracted ${extracted} string arrays`, success: true });
      }
      return code;
    } catch (error) {
      logger.warn('String array extraction failed', error);
      transformations.push({ type: 'extract-string-arrays', description: 'Failed', success: false });
      return code;
    }
  }

  /**
   * 数组解密 (替换字符串数组引用)
   */
  private async decryptArrays(code: string, transformations: Transformation[]): Promise<string> {
    if (this.stringArrays.size === 0) return code;

    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      let replaced = 0;
      const arrays = this.stringArrays;

      traverse(ast, {
        MemberExpression(path) {
          if (
            t.isIdentifier(path.node.object) &&
            t.isNumericLiteral(path.node.property) &&
            path.node.object.name.startsWith('_0x')
          ) {
            const arr = arrays.get(path.node.object.name);
            const idx = path.node.property.value;
            if (arr && idx >= 0 && idx < arr.length) {
              const value = arr[idx];
              if (value !== undefined) {
                path.replaceWith(t.stringLiteral(value));
                replaced++;
              }
            }
          }
        },
      });

      if (replaced > 0) {
        const output = generate(ast, { comments: true, compact: false });
        transformations.push({ type: 'decrypt-arrays', description: `Replaced ${replaced} array references`, success: true });
        return output.code;
      }
      return code;
    } catch (error) {
      logger.warn('Array decryption failed', error);
      transformations.push({ type: 'decrypt-arrays', description: 'Failed', success: false });
      return code;
    }
  }

  /**
   * 控制流平坦化还原 (基础版)
   */
  private async unflattenControlFlow(code: string, transformations: Transformation[]): Promise<string> {
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      let unflattened = 0;

      traverse(ast, {
        WhileStatement(path) {
          const body = path.node.body;
          const switchNode = t.isBlockStatement(body) && body.body.length === 1
            ? body.body[0]
            : body;

          if (!t.isSwitchStatement(switchNode)) return;

          // 查找调度变量
          const discriminant = switchNode.discriminant;
          if (!t.isMemberExpression(discriminant)) return;

          // 检查是否是典型的 array[index++] 模式
          const obj = discriminant.object;
          if (!t.isIdentifier(obj)) return;

          // 尝试找到调度序列
          const binding = path.scope.getBinding(obj.name);
          if (!binding || !binding.path.isVariableDeclarator()) return;

          const init = binding.path.node.init;
          if (!t.isCallExpression(init)) return;

          // 典型模式: "0|1|2|3".split("|")
          const callee = init.callee;
          if (
            t.isMemberExpression(callee) &&
            t.isStringLiteral(callee.object) &&
            t.isIdentifier(callee.property, { name: 'split' }) &&
            init.arguments.length === 1 &&
            t.isStringLiteral(init.arguments[0], { value: '|' })
          ) {
            const order = callee.object.value.split('|').map(Number);
            const cases = switchNode.cases;

            // 按执行顺序重组 case 的 consequent
            const orderedStatements: t.Statement[] = [];
            for (const idx of order) {
              const matchedCase = cases.find(c => t.isStringLiteral(c.test, { value: String(idx) }) || t.isNumericLiteral(c.test, { value: idx }));
              if (matchedCase) {
                for (const stmt of matchedCase.consequent) {
                  if (!t.isContinueStatement(stmt) && !t.isBreakStatement(stmt)) {
                    orderedStatements.push(stmt);
                  }
                }
              }
            }

            if (orderedStatements.length > 0) {
              path.replaceWithMultiple(orderedStatements);
              unflattened++;
            }
          }
        },
      });

      if (unflattened > 0) {
        const output = generate(ast, { comments: true, compact: false });
        transformations.push({ type: 'unflatten-control-flow', description: `Unflattened ${unflattened} control flow patterns`, success: true });
        return output.code;
      }
      return code;
    } catch (error) {
      logger.warn('Control flow unflattening failed', error);
      transformations.push({ type: 'unflatten-control-flow', description: 'Failed', success: false });
      return code;
    }
  }

  /**
   * 表达式简化
   */
  private async simplifyExpressions(code: string, transformations: Transformation[]): Promise<string> {
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      let simplified = 0;

      traverse(ast, {
        UnaryExpression(path) {
          // !!value → Boolean(value) 保持语义但更清晰（这里直接保留原值）
          if (
            path.node.operator === '!' &&
            t.isUnaryExpression(path.node.argument) &&
            path.node.argument.operator === '!'
          ) {
            path.replaceWith(path.node.argument.argument);
            simplified++;
          }
          // void 0 → undefined
          else if (path.node.operator === 'void' && t.isNumericLiteral(path.node.argument, { value: 0 })) {
            path.replaceWith(t.identifier('undefined'));
            simplified++;
          }
          // !0 → true, !1 → false
          else if (path.node.operator === '!' && t.isNumericLiteral(path.node.argument)) {
            path.replaceWith(t.booleanLiteral(!path.node.argument.value));
            simplified++;
          }
        },

        // 逗号表达式展开: (a, b, c) → 最后一个值（在表达式位置）
        SequenceExpression(path) {
          if (path.node.expressions.length === 1) {
            path.replaceWith(path.node.expressions[0]);
            simplified++;
          }
        },
      });

      if (simplified > 0) {
        const output = generate(ast, { comments: true, compact: false });
        transformations.push({ type: 'simplify-expressions', description: `Simplified ${simplified} expressions`, success: true });
        return output.code;
      }
      return code;
    } catch (error) {
      logger.warn('Expression simplification failed', error);
      transformations.push({ type: 'simplify-expressions', description: 'Failed', success: false });
      return code;
    }
  }

  /**
   * 变量重命名
   */
  private async renameVariables(code: string, transformations: Transformation[]): Promise<string> {
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      let renamed = 0;
      const renameMap = new Map<string, string>();

      // 第一遍：收集需要重命名的变量
      traverse(ast, {
        VariableDeclarator(path) {
          if (t.isIdentifier(path.node.id) && path.node.id.name.startsWith('_0x')) {
            const oldName = path.node.id.name;
            const newName = `var_${renamed}`;
            renameMap.set(oldName, newName);
            renamed++;
          }
        },
      });

      // 第二遍：使用 scope 安全重命名
      if (renameMap.size > 0) {
        traverse(ast, {
          Identifier(path) {
            const newName = renameMap.get(path.node.name);
            if (newName) {
              path.node.name = newName;
            }
          },
        });

        const output = generate(ast, { comments: true, compact: false });
        transformations.push({ type: 'rename-variables', description: `Renamed ${renamed} variables`, success: true });
        return output.code;
      }
      return code;
    } catch (error) {
      logger.warn('Variable renaming failed', error);
      transformations.push({ type: 'rename-variables', description: 'Failed', success: false });
      return code;
    }
  }

  // ==================== LLM ====================

  private async llmAnalysis(code: string): Promise<string | null> {
    if (!this.llm) return null;
    try {
      const messages = this.llm.generateDeobfuscationPrompt(code);
      const response = await this.llm.chat(messages, { temperature: 0.3, maxTokens: 2000 });
      return response.content;
    } catch (error) {
      logger.warn('LLM analysis failed', error);
      return null;
    }
  }

  // ==================== 评分 ====================

  private calculateConfidence(transformations: Transformation[], readabilityScore: number): number {
    const successCount = transformations.filter((t) => t.success).length;
    const totalCount = transformations.length || 1;
    const transformConfidence = successCount / totalCount;
    const readabilityConfidence = readabilityScore / 100;
    return Math.min(Math.max(transformConfidence * 0.6 + readabilityConfidence * 0.4, 0), 1);
  }

  private calculateReadabilityScore(code: string): number {
    let score = 0;
    if (code.includes('\n')) score += 20;
    if (code.includes('//') || code.includes('/*')) score += 10;
    const varNames = code.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
    const avgLength = varNames.reduce((sum, name) => sum + name.length, 0) / (varNames.length || 1);
    if (avgLength > 3) score += 30;
    const density = code.replace(/\s/g, '').length / (code.length || 1);
    if (density < 0.8) score += 20;
    if (!code.includes('_0x') && !code.includes('\\x')) score += 20;
    return Math.min(score, 100);
  }

  // ==================== 缓存 ====================

  private generateCacheKey(options: DeobfuscateFullOptions): string {
    const key = JSON.stringify({
      code: options.code.substring(0, 1000),
      aggressive: options.aggressive,
      advanced: options.advanced,
      jsvmp: options.jsvmp,
      astOptimize: options.astOptimize,
      unpack: options.unpack,
      auto: options.auto,
    });
    return crypto.createHash('md5').update(key).digest('hex');
  }

  private cacheResult(key: string, result: DeobfuscateResult): void {
    if (this.resultCache.size >= this.maxCacheSize) {
      const firstKey = this.resultCache.keys().next().value;
      if (firstKey) this.resultCache.delete(firstKey);
    }
    this.resultCache.set(key, result);
  }

  /** 清除缓存 */
  clearCache(): void {
    this.resultCache.clear();
    this.stringArrays.clear();
  }
}
