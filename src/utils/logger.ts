/**
 * 日志工具
 */

import chalk from 'chalk';
import { safeStringify } from './safeJson.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private level: LogLevel;

  // ✅ 修复：性能优化 - 使用静态常量避免重复创建数组
  private static readonly LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return Logger.LEVELS.indexOf(level) >= Logger.LEVELS.indexOf(this.level);
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    // ✅ 修复：使用 safeStringify 处理循环引用和特殊对象
    const formattedArgs = args.length > 0 ? ' ' + safeStringify(args) : '';
    return `${prefix} ${message}${formattedArgs}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      // 使用 stderr 避免干扰 MCP 的 stdout 通信
      console.error(chalk.gray(this.formatMessage('debug', message, ...args)));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      // 使用 stderr 避免干扰 MCP 的 stdout 通信
      console.error(chalk.blue(this.formatMessage('info', message, ...args)));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.error(chalk.yellow(this.formatMessage('warn', message, ...args)));
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red(this.formatMessage('error', message, ...args)));
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      // 使用 stderr 避免干扰 MCP 的 stdout 通信
      console.error(chalk.green(this.formatMessage('info', message, ...args)));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

// ✅ 修复：安全的环境变量解析
function parseLogLevel(value: string | undefined): LogLevel {
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (value && validLevels.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  return 'info';
}

// 导出单例
export const logger = new Logger(parseLogLevel(process.env.LOG_LEVEL));

