/**
 * CryptoDetector 增强方法
 * 包含统一AST解析、安全评估、强度分析等新功能
 */

import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
const traverse = (traverseImport as unknown as {default?: typeof traverseImport}).default ?? traverseImport;
import * as t from '@babel/types';
import type { CryptoAlgorithm } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { CryptoRulesManager } from './CryptoRules.js';

export interface SecurityIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  algorithm?: string;
  issue: string;
  recommendation: string;
  location?: { file: string; line: number };
}

export interface CryptoStrength {
  overall: 'strong' | 'moderate' | 'weak' | 'broken';
  score: number; // 0-100
  factors: {
    algorithm: number;
    keySize: number;
    mode: number;
    implementation: number;
  };
}

export interface ASTDetectionResult {
  algorithms: CryptoAlgorithm[];
  parameters: Map<string, Record<string, unknown>>;
}

/**
 * 统一AST解析和检测（性能优化 - 单次遍历）
 */
export function detectByAST(
  code: string,
  rulesManager: CryptoRulesManager
): ASTDetectionResult {
  const algorithms: CryptoAlgorithm[] = [];
  const parameters = new Map<string, Record<string, unknown>>();

  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    const constantRules = rulesManager.getConstantRules();

    traverse(ast, {
      // 检测S-box（替换盒）- 对称加密的特征
      VariableDeclarator(path) {
        const node = path.node;
        if (
          node.init?.type === 'ArrayExpression' &&
          node.init.elements.length === 256 &&
          node.id.type === 'Identifier' &&
          (node.id.name.toLowerCase().includes('sbox') || 
           node.id.name.toLowerCase().includes('box') ||
           node.id.name.toLowerCase().includes('table'))
        ) {
          algorithms.push({
            name: 'Custom Symmetric Cipher',
            type: 'symmetric',
            confidence: 0.8,
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
            },
            usage: `S-box array detected (${node.id.name}), likely custom or standard symmetric encryption`,
          });
        }
      },

      // 检测大数运算 - 非对称加密的特征
      CallExpression(path) {
        const node = path.node;
        
        // 检测大数运算方法
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier'
        ) {
          const methodName = node.callee.property.name;
          
          if (['modPow', 'modInverse', 'gcd', 'isProbablePrime'].includes(methodName)) {
            algorithms.push({
              name: 'Asymmetric Encryption',
              type: 'asymmetric',
              confidence: 0.75,
              location: {
                file: 'current',
                line: node.loc?.start.line || 0,
              },
              usage: `Big number operation detected: ${methodName}`,
            });
          }

          // 提取加密参数
          extractCryptoParameters(node, parameters);
        }
      },

      // 检测哈希函数特征
      FunctionDeclaration(path) {
        const node = path.node;
        const funcName = node.id?.name.toLowerCase() || '';

        if (funcName.includes('hash') || funcName.includes('digest') || funcName.includes('checksum')) {
          const bodyCode = code.substring(node.start || 0, node.end || 0);

          // 检测循环和位运算 - 哈希函数的特征
          const hasLoop = bodyCode.includes('for') || bodyCode.includes('while');
          const hasBitOps = />>>|<<|&|\||\^/.test(bodyCode);

          if (hasLoop && hasBitOps) {
            algorithms.push({
              name: 'Custom Hash Function',
              type: 'hash',
              confidence: 0.7,
              location: {
                file: 'current',
                line: node.loc?.start.line || 0,
              },
              usage: `Hash function detected: ${funcName}`,
            });
          }
        }
      },

      // 检测加密常量（魔数）
      ArrayExpression(path) {
        const elements = path.node.elements;
        if (elements.length < 4) return;

        // 提取数组中的数值
        const values: number[] = [];
        elements.forEach((element) => {
          if (t.isNumericLiteral(element)) {
            values.push(element.value);
          }
        });

        // 检查是否匹配已知的加密常量（支持任意位置匹配）
        constantRules.forEach((rule) => {
          if (rule.values.length > values.length) return;

          let matched = false;
          // 滑动窗口：在 values 中查找连续子序列
          for (let offset = 0; offset <= values.length - rule.values.length; offset++) {
            const allMatch = rule.values.every((c, i) => values[offset + i] === c);
            if (allMatch) {
              matched = true;
              break;
            }
          }

          if (matched) {
            // 将 'other' 类型映射到 'encoding'
            const algoType = rule.type === 'other' ? 'encoding' : rule.type;

            algorithms.push({
              name: rule.name,
              type: algoType as CryptoAlgorithm['type'],
              confidence: rule.confidence,
              location: {
                file: 'current',
                line: path.node.loc?.start.line || 0,
              },
              usage: `${rule.name} initialization constants detected${rule.description ? ` (${rule.description})` : ''}`,
            });
          }
        });
      },
    });
  } catch (error) {
    logger.warn('AST detection failed', error);
  }

  return { algorithms, parameters };
}

/**
 * 提取加密参数
 */
function extractCryptoParameters(
  node: t.CallExpression,
  parameters: Map<string, Record<string, unknown>>
): void {
  if (!t.isMemberExpression(node.callee)) return;

  const calleeName = getCalleeFullName(node.callee);

  // 检测CryptoJS模式
  if (calleeName.includes('CryptoJS')) {
    const algoMatch = calleeName.match(/CryptoJS\.(AES|DES|TripleDES|RC4|Rabbit|RabbitLegacy)/);
    if (algoMatch) {
      const algoName = algoMatch[1];
      const params: Record<string, unknown> = {};

      // 第三个参数通常是配置对象
      if (node.arguments.length >= 3 && t.isObjectExpression(node.arguments[2])) {
        const config = node.arguments[2];
        config.properties.forEach((prop) => {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            const key = prop.key.name;
            if (t.isIdentifier(prop.value)) {
              params[key] = prop.value.name;
            } else if (t.isStringLiteral(prop.value)) {
              params[key] = prop.value.value;
            } else if (t.isNumericLiteral(prop.value)) {
              params[key] = prop.value.value;
            }
          }
        });
      }

      if (algoName) {
        parameters.set(algoName, params);
      }
    }
  }

  // 检测Web Crypto API
  if (calleeName.includes('crypto.subtle')) {
    const methodMatch = calleeName.match(/\.(encrypt|decrypt|sign|verify|digest|generateKey)/);
    if (methodMatch && node.arguments.length > 0) {
      const firstArg = node.arguments[0];
      if (t.isObjectExpression(firstArg)) {
        const params: Record<string, unknown> = {};
        firstArg.properties.forEach((prop) => {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            const key = prop.key.name;
            if (t.isStringLiteral(prop.value)) {
              params[key] = prop.value.value;
            } else if (t.isNumericLiteral(prop.value)) {
              params[key] = prop.value.value;
            }
          }
        });

        const algoName = (params.name as string) || 'WebCrypto';
        if (algoName) {
          parameters.set(algoName, params);
        }
      }
    }
  }
}

/**
 * 获取完整的调用名称
 */
function getCalleeFullName(node: t.MemberExpression): string {
  const parts: string[] = [];

  const traverseNode = (n: t.Expression | t.V8IntrinsicIdentifier): void => {
    if (t.isMemberExpression(n)) {
      traverseNode(n.object);
      if (t.isIdentifier(n.property)) {
        parts.push(n.property.name);
      }
    } else if (t.isIdentifier(n)) {
      parts.push(n.name);
    }
  };

  traverseNode(node);
  return parts.join('.');
}

/**
 * 合并参数到算法
 */
export function mergeParameters(
  algorithms: CryptoAlgorithm[],
  parameters: Map<string, Record<string, unknown>>
): void {
  algorithms.forEach((algo) => {
    const params = parameters.get(algo.name);
    if (params) {
      algo.parameters = { ...algo.parameters, ...params };
    }
  });
}

/**
 * 安全性评估
 */
export function evaluateSecurity(
  algorithms: CryptoAlgorithm[],
  _code: string, // 保留参数以便未来扩展
  rulesManager: CryptoRulesManager
): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const securityRules = rulesManager.getSecurityRules();

  algorithms.forEach((algo) => {
    const context = {
      algorithm: algo.name,
      mode: algo.parameters?.mode as string,
      padding: algo.parameters?.padding as string,
      keySize: (algo.parameters as any)?.keySize as number, // keySize 可能存在于参数中
    };

    securityRules.forEach((rule) => {
      if (rule.check(context)) {
        issues.push({
          severity: rule.severity,
          algorithm: algo.name,
          issue: rule.message,
          recommendation: rule.recommendation || '',
          location: algo.location,
        });
      }
    });
  });

  return issues;
}

/**
 * 加密强度分析
 */
export function analyzeStrength(
  _algorithms: CryptoAlgorithm[], // 保留参数以便未来扩展
  securityIssues: SecurityIssue[]
): CryptoStrength {
  let algorithmScore = 100;
  let keySizeScore = 100;
  let modeScore = 100;
  let implementationScore = 100;

  // 根据安全问题降低分数
  // 基于 issue 来源分类（而非匹配 message 文本，避免误分类）
  const algorithmIssueKeywords = ['broken', 'deprecated', 'vulnerable', 'MD5', 'SHA-1', 'SHA1', 'DES', 'RC4'];
  const keySizeIssueKeywords = ['key size', 'key length', 'short', 'bits'];
  const modeIssueKeywords = ['ECB', 'mode', 'padding', 'NoPadding'];

  securityIssues.forEach((issue) => {
    const penalty = {
      critical: 40,
      high: 25,
      medium: 15,
      low: 5,
    }[issue.severity];

    const text = issue.issue.toLowerCase();

    if (modeIssueKeywords.some(k => text.includes(k.toLowerCase()))) {
      modeScore -= penalty;
    } else if (keySizeIssueKeywords.some(k => text.includes(k.toLowerCase()))) {
      keySizeScore -= penalty;
    } else if (algorithmIssueKeywords.some(k => text.includes(k.toLowerCase()))) {
      algorithmScore -= penalty;
    } else {
      implementationScore -= penalty;
    }
  });

  // 确保分数不低于0
  algorithmScore = Math.max(0, algorithmScore);
  keySizeScore = Math.max(0, keySizeScore);
  modeScore = Math.max(0, modeScore);
  implementationScore = Math.max(0, implementationScore);

  // 计算总分
  const totalScore = (algorithmScore + keySizeScore + modeScore + implementationScore) / 4;

  // 确定整体强度
  let overall: CryptoStrength['overall'];
  if (totalScore >= 80) {
    overall = 'strong';
  } else if (totalScore >= 60) {
    overall = 'moderate';
  } else if (totalScore >= 40) {
    overall = 'weak';
  } else {
    overall = 'broken';
  }

  return {
    overall,
    score: Math.round(totalScore),
    factors: {
      algorithm: Math.round(algorithmScore),
      keySize: Math.round(keySizeScore),
      mode: Math.round(modeScore),
      implementation: Math.round(implementationScore),
    },
  };
}

