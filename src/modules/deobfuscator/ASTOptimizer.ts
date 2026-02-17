/**
 * AST优化器 - 基于Babel的高级反混淆转换
 * 
 * 实现的转换:
 * 1. 常量折叠 (Constant Folding)
 * 2. 常量传播 (Constant Propagation)
 * 3. 死代码消除 (Dead Code Elimination)
 * 4. 表达式简化 (Expression Simplification)
 * 5. 变量内联 (Variable Inlining)
 * 6. 对象属性展开 (Object Property Unfolding)
 * 7. 计算属性名还原 (Computed Property Name Resolution)
 * 8. 序列表达式展开 (Sequence Expression Expansion)
 */

import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
const traverse = (traverseImport as unknown as {default?: typeof traverseImport}).default ?? traverseImport;
import generateImport from '@babel/generator';
const generate = (generateImport as unknown as {default?: typeof generateImport}).default ?? generateImport;
import * as t from '@babel/types';
import { logger } from '../../utils/logger.js';

export class ASTOptimizer {
  /**
   * 优化代码
   */
  optimize(code: string): string {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      // 执行多轮优化
      for (let i = 0; i < 3; i++) {
        logger.debug(`AST optimization pass ${i + 1}`);
        
        this.constantFolding(ast);
        this.constantPropagation(ast);
        this.deadCodeElimination(ast);
        this.expressionSimplification(ast);
        this.variableInlining(ast);
        this.objectPropertyUnfolding(ast);
        this.computedPropertyResolution(ast);
        this.sequenceExpressionExpansion(ast);
      }

      const output = generate(ast, {
        comments: false,
        compact: false,
      });

      return output.code;
    } catch (error) {
      logger.error('AST optimization failed', error);
      return code;
    }
  }

  /**
   * 常量折叠
   * 例如: 1 + 2 -> 3
   */
  private constantFolding(ast: t.File): void {
    traverse(ast, {
      BinaryExpression(path) {
        const { left, right, operator } = path.node;

        if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
          let result: number;

          switch (operator) {
            case '+':
              result = left.value + right.value;
              break;
            case '-':
              result = left.value - right.value;
              break;
            case '*':
              result = left.value * right.value;
              break;
            case '/':
              result = left.value / right.value;
              break;
            case '%':
              result = left.value % right.value;
              break;
            case '**':
              result = left.value ** right.value;
              break;
            default:
              return;
          }

          path.replaceWith(t.numericLiteral(result));
        }

        // 字符串拼接
        if (t.isStringLiteral(left) && t.isStringLiteral(right) && operator === '+') {
          path.replaceWith(t.stringLiteral(left.value + right.value));
        }
      },

      UnaryExpression(path) {
        const { argument, operator } = path.node;

        if (t.isNumericLiteral(argument)) {
          if (operator === '-') {
            path.replaceWith(t.numericLiteral(-argument.value));
          } else if (operator === '+') {
            path.replaceWith(t.numericLiteral(argument.value));
          } else if (operator === '!') {
            path.replaceWith(t.booleanLiteral(!argument.value));
          }
        }

        if (t.isBooleanLiteral(argument) && operator === '!') {
          path.replaceWith(t.booleanLiteral(!argument.value));
        }
      },
    });
  }

  /**
   * 常量传播
   * 例如: const a = 5; const b = a; -> const b = 5;
   */
  private constantPropagation(ast: t.File): void {
    const constants = new Map<string, t.Expression>();

    traverse(ast, {
      VariableDeclarator(path) {
        const { id, init } = path.node;

        if (t.isIdentifier(id) && init && t.isLiteral(init)) {
          constants.set(id.name, init);
        }
      },

      Identifier(path: any) {
        const name = path.node.name;
        const constant = constants.get(name);

        if (constant && !path.isBindingIdentifier()) {
          path.replaceWith(t.cloneNode(constant));
        }
      },
    });
  }

  /**
   * 死代码消除
   * 例如: if (false) { ... } -> 删除
   */
  private deadCodeElimination(ast: t.File): void {
    traverse(ast, {
      IfStatement(path) {
        const { test, consequent, alternate } = path.node;

        if (t.isBooleanLiteral(test)) {
          if (test.value) {
            // if (true) -> 保留consequent
            path.replaceWith(consequent);
          } else {
            // if (false) -> 保留alternate或删除
            if (alternate) {
              path.replaceWith(alternate);
            } else {
              path.remove();
            }
          }
        }
      },

      ConditionalExpression(path) {
        const { test, consequent, alternate } = path.node;

        if (t.isBooleanLiteral(test)) {
          path.replaceWith(test.value ? consequent : alternate);
        }
      },

      LogicalExpression(path) {
        const { left, right, operator } = path.node;

        if (t.isBooleanLiteral(left)) {
          if (operator === '&&') {
            path.replaceWith(left.value ? right : left);
          } else if (operator === '||') {
            path.replaceWith(left.value ? left : right);
          }
        }
      },
    });
  }

  /**
   * 表达式简化
   */
  private expressionSimplification(ast: t.File): void {
    traverse(ast, {
      BinaryExpression(path) {
        const { left, right, operator } = path.node;

        // x + 0 -> x
        if (operator === '+' && t.isNumericLiteral(right) && right.value === 0) {
          path.replaceWith(left);
        }

        // x * 1 -> x
        if (operator === '*' && t.isNumericLiteral(right) && right.value === 1) {
          path.replaceWith(left);
        }

        // x * 0 -> 0
        if (operator === '*' && t.isNumericLiteral(right) && right.value === 0) {
          path.replaceWith(t.numericLiteral(0));
        }
      },

      UnaryExpression(path) {
        const { argument, operator } = path.node;

        // !!x -> Boolean(x)
        if (
          operator === '!' &&
          t.isUnaryExpression(argument) &&
          argument.operator === '!'
        ) {
          path.replaceWith(
            t.callExpression(t.identifier('Boolean'), [argument.argument])
          );
        }
      },
    });
  }

  /**
   * 变量内联
   * 例如: const a = 5; console.log(a); -> console.log(5);
   */
  private variableInlining(ast: t.File): void {
    const inlineCandidates = new Map<string, { value: t.Expression; usageCount: number }>();

    // 第一遍：收集候选变量
    traverse(ast, {
      VariableDeclarator(path) {
        const { id, init } = path.node;

        if (t.isIdentifier(id) && init && t.isLiteral(init)) {
          inlineCandidates.set(id.name, { value: init, usageCount: 0 });
        }
      },

      Identifier(path) {
        const name = path.node.name;
        const candidate = inlineCandidates.get(name);

        if (candidate && !path.isBindingIdentifier()) {
          candidate.usageCount++;
        }
      },
    });

    // 第二遍：内联使用次数少的变量
    traverse(ast, {
      Identifier(path: any) {
        const name = path.node.name;
        const candidate = inlineCandidates.get(name);

        if (candidate && candidate.usageCount <= 3 && !path.isBindingIdentifier()) {
          path.replaceWith(t.cloneNode(candidate.value));
        }
      },
    });
  }

  /**
   * 对象属性展开
   * 例如: obj['prop'] -> obj.prop
   */
  private objectPropertyUnfolding(ast: t.File): void {
    traverse(ast, {
      MemberExpression(path) {
        const { object, property, computed } = path.node;

        if (computed && t.isStringLiteral(property)) {
          // 检查属性名是否是有效的标识符
          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(property.value)) {
            path.replaceWith(
              t.memberExpression(object, t.identifier(property.value), false)
            );
          }
        }
      },
    });
  }

  /**
   * 计算属性名还原
   */
  private computedPropertyResolution(ast: t.File): void {
    traverse(ast, {
      ObjectProperty(path) {
        const { key, computed } = path.node;

        if (computed && t.isStringLiteral(key)) {
          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key.value)) {
            path.node.computed = false;
            path.node.key = t.identifier(key.value);
          }
        }
      },
    });
  }

  /**
   * 序列表达式展开
   * 例如: (a, b, c) -> c (在某些情况下)
   */
  private sequenceExpressionExpansion(ast: t.File): void {
    traverse(ast, {
      SequenceExpression(path: any) {
        const { expressions } = path.node;

        // 如果序列表达式只有一个元素，直接替换
        if (expressions.length === 1 && expressions[0]) {
          path.replaceWith(expressions[0]);
        }

        // 如果在表达式语句中，展开为多个语句
        if (path.parentPath.isExpressionStatement()) {
          const statements = expressions.map((expr: t.Expression) => t.expressionStatement(expr));
          path.parentPath.replaceWithMultiple(statements);
        }
      },
    });
  }
}

