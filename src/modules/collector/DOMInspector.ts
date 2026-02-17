/**
 * DOM检查器 - 薄封装CDP DOM域
 * 
 * 功能:
 * - 查询DOM元素（querySelector, querySelectorAll）
 * - 获取元素属性和位置
 * - 获取页面DOM结构
 * - 查找可点击元素
 * 
 * 设计原则:
 * - 薄封装CDP DOM域API
 * - 依赖CodeCollector获取Page实例
 * - 解决"AI点击前需要先知道元素存在"的问题
 */

import type { CDPSession } from 'puppeteer';
import type { CodeCollector } from './CodeCollector.js';
import { logger } from '../../utils/logger.js';

export interface ElementInfo {
  found: boolean;
  nodeId?: number;
  nodeName?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visible?: boolean;
}

export interface ClickableElement {
  selector: string;
  text: string;
  type: 'button' | 'link' | 'input' | 'other';
  visible: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export class DOMInspector {
  private cdpSession: CDPSession | null = null;

  constructor(private collector: CodeCollector) {}

  /**
   * 查询单个元素（类似document.querySelector）
   */
  async querySelector(selector: string, _getAttributes = true): Promise<ElementInfo> {
    try {
      const page = await this.collector.getActivePage();

      // 使用page.evaluate查询元素（更简单可靠）
      const elementInfo = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return { found: false };
        }

        // 获取元素属性
        const attributes: Record<string, string> = {};
        const attrs = element.attributes;
        for (let i = 0; i < attrs.length; i++) {
          const attr = attrs[i];
          if (attr) {
            attributes[attr.name] = attr.value;
          }
        }

        // 获取边界框
        const rect = element.getBoundingClientRect();
        const boundingBox = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };

        // 检查可见性
        const style = window.getComputedStyle(element);
        const visible = style.display !== 'none' && 
                       style.visibility !== 'hidden' && 
                       style.opacity !== '0';

        return {
          found: true,
          nodeName: element.nodeName,
          attributes,
          textContent: element.textContent?.trim() || '',
          boundingBox,
          visible,
        };
      }, selector);

      logger.info(`querySelector: ${selector} - ${elementInfo.found ? 'found' : 'not found'}`);
      return elementInfo;
    } catch (error) {
      logger.error(`querySelector failed for ${selector}:`, error);
      return { found: false };
    }
  }

  /**
   * 查询所有匹配的元素（类似document.querySelectorAll）
   *
   * 🔧 修复：降低默认限制，防止返回过多数据导致 MCP token 溢出
   *
   * @param selector CSS选择器
   * @param limit 最大返回元素数量（默认50，原100）
   */
  async querySelectorAll(selector: string, limit = 50): Promise<ElementInfo[]> {
    try {
      const page = await this.collector.getActivePage();

      const elements = await page.evaluate((sel, maxLimit) => {
        const nodeList = document.querySelectorAll(sel);

        // 🔧 如果超过限制，输出警告
        if (nodeList.length > maxLimit) {
          console.warn(`[DOMInspector] Found ${nodeList.length} elements for "${sel}", limiting to ${maxLimit}`);
        }

        const results: any[] = [];

        for (let i = 0; i < Math.min(nodeList.length, maxLimit); i++) {
          const element = nodeList[i];
          if (!element) continue;

          const attributes: Record<string, string> = {};
          const attrs = element.attributes;
          for (let j = 0; j < attrs.length; j++) {
            const attr = attrs[j];
            if (attr) {
              attributes[attr.name] = attr.value;
            }
          }

          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          // 🔧 限制 textContent 长度，防止单个元素文本过长
          const textContent = element.textContent?.trim() || '';
          const truncatedText = textContent.length > 500
            ? textContent.substring(0, 500) + '...[truncated]'
            : textContent;

          results.push({
            found: true,
            nodeName: element.nodeName,
            attributes,
            textContent: truncatedText,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            visible: style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0',
          });
        }

        return results;
      }, selector, limit);

      logger.info(`querySelectorAll: ${selector} - found ${elements.length} elements (limit: ${limit})`);
      return elements;
    } catch (error) {
      logger.error(`querySelectorAll failed for ${selector}:`, error);
      return [];
    }
  }

  /**
   * 获取页面DOM结构（用于AI理解页面布局）
   */
  async getStructure(maxDepth = 3, includeText = true): Promise<any> {
    try {
      const page = await this.collector.getActivePage();

      const structure = await page.evaluate((depth, withText) => {
        function buildTree(node: Element, currentDepth: number): any {
          if (currentDepth > depth) {
            return null;
          }

          const result: any = {
            tag: node.tagName,
            id: node.id || undefined,
            class: node.className || undefined,
          };

          if (withText && node.childNodes.length === 1) {
            const firstChild = node.childNodes[0];
            if (firstChild && firstChild.nodeType === 3) {
              result.text = node.textContent?.trim();
            }
          }

          const children: any[] = [];
          const childElements = node.children;
          for (let i = 0; i < childElements.length; i++) {
            const child = childElements[i];
            if (child) {
              const childTree = buildTree(child, currentDepth + 1);
              if (childTree) {
                children.push(childTree);
              }
            }
          }

          if (children.length > 0) {
            result.children = children;
          }

          return result;
        }

        return buildTree(document.body, 0);
      }, maxDepth, includeText);

      logger.info('DOM structure retrieved');
      return structure;
    } catch (error) {
      logger.error('getStructure failed:', error);
      return null;
    }
  }

  /**
   * 查找所有可点击元素（按钮、链接等）
   */
  async findClickable(filterText?: string): Promise<ClickableElement[]> {
    try {
      const page = await this.collector.getActivePage();

      const clickableElements = await page.evaluate((filter) => {
        const results: any[] = [];

        // 查找按钮
        const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
        buttons.forEach((btn) => {
          const text = btn.textContent?.trim() || (btn as HTMLInputElement).value || '';
          if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
            return;
          }

          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          const visible = style.display !== 'none' && 
                         style.visibility !== 'hidden' && 
                         style.opacity !== '0' &&
                         rect.width > 0 && rect.height > 0;

          // 生成选择器
          let selector = btn.tagName.toLowerCase();
          if (btn.id) {
            selector = `#${btn.id}`;
          } else if (btn.className) {
            selector = `${btn.tagName.toLowerCase()}.${btn.className.split(' ')[0]}`;
          }

          results.push({
            selector,
            text,
            type: 'button',
            visible,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          });
        });

        // 查找链接
        const links = document.querySelectorAll('a[href]');
        links.forEach((link) => {
          const text = link.textContent?.trim() || '';
          if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
            return;
          }

          const rect = link.getBoundingClientRect();
          const style = window.getComputedStyle(link);
          const visible = style.display !== 'none' && 
                         style.visibility !== 'hidden' && 
                         style.opacity !== '0' &&
                         rect.width > 0 && rect.height > 0;

          let selector = 'a';
          if (link.id) {
            selector = `#${link.id}`;
          } else if (link.className) {
            selector = `a.${link.className.split(' ')[0]}`;
          }

          results.push({
            selector,
            text,
            type: 'link',
            visible,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          });
        });

        return results;
      }, filterText);

      logger.info(`findClickable: found ${clickableElements.length} elements${filterText ? ` (filtered by: ${filterText})` : ''}`);
      return clickableElements;
    } catch (error) {
      logger.error('findClickable failed:', error);
      return [];
    }
  }

  /**
   * 🆕 获取元素的计算样式
   */
  async getComputedStyle(selector: string): Promise<Record<string, string> | null> {
    try {
      const page = await this.collector.getActivePage();

      const styles = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return null;
        }

        const computed = window.getComputedStyle(element);
        const result: Record<string, string> = {};

        // 获取常用样式属性
        const importantProps = [
          'display', 'visibility', 'opacity', 'position', 'z-index',
          'width', 'height', 'top', 'left', 'right', 'bottom',
          'color', 'background-color', 'font-size', 'font-family',
          'border', 'padding', 'margin', 'overflow',
        ];

        for (const prop of importantProps) {
          result[prop] = computed.getPropertyValue(prop);
        }

        return result;
      }, selector);

      logger.info(`getComputedStyle: ${selector} - ${styles ? 'found' : 'not found'}`);
      return styles;
    } catch (error) {
      logger.error(`getComputedStyle failed for ${selector}:`, error);
      return null;
    }
  }

  /**
   * 🆕 等待元素出现（动态DOM监控）
   */
  async waitForElement(selector: string, timeout = 30000): Promise<ElementInfo | null> {
    try {
      const page = await this.collector.getActivePage();

      // 等待元素出现
      await page.waitForSelector(selector, { timeout });

      // 获取元素信息
      return await this.querySelector(selector);
    } catch (error) {
      logger.error(`waitForElement timeout for ${selector}:`, error);
      return null;
    }
  }

  /**
   * 🆕 监听DOM变化（MutationObserver）
   */
  async observeDOMChanges(options: {
    selector?: string;
    childList?: boolean;
    attributes?: boolean;
    characterData?: boolean;
    subtree?: boolean;
  } = {}): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate((opts) => {
      const targetNode = opts.selector
        ? document.querySelector(opts.selector)
        : document.body;

      if (!targetNode) {
        console.error('Target node not found for MutationObserver');
        return;
      }

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          console.log('[DOM Change]', {
            type: mutation.type,
            target: mutation.target,
            addedNodes: mutation.addedNodes.length,
            removedNodes: mutation.removedNodes.length,
            attributeName: mutation.attributeName,
          });
        });
      });

      observer.observe(targetNode, {
        childList: opts.childList !== false,
        attributes: opts.attributes !== false,
        characterData: opts.characterData !== false,
        subtree: opts.subtree !== false,
      });

      // 存储observer以便后续停止
      (window as any).__domObserver = observer;
    }, options);

    logger.info('DOM change observer started');
  }

  /**
   * 🆕 停止DOM监听
   */
  async stopObservingDOM(): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate(() => {
      const observer = (window as any).__domObserver;
      if (observer) {
        observer.disconnect();
        delete (window as any).__domObserver;
      }
    });

    logger.info('DOM change observer stopped');
  }

  /**
   * 🆕 查找包含特定文本的元素
   */
  async findByText(text: string, tag?: string): Promise<ElementInfo[]> {
    try {
      const page = await this.collector.getActivePage();

      const elements = await page.evaluate((searchText, tagName) => {
        // 转义 XPath 中的引号，防止注入
        const escapeXPathString = (str: string): string => {
          if (!str.includes('"')) return `"${str}"`;
          if (!str.includes("'")) return `'${str}'`;
          // 同时包含单双引号时，使用 concat 拼接
          return `concat(${str.split('"').map((part, i) => i === 0 ? `"${part}"` : `'"',"${part}"`).join(',')})`;
        };
        const escaped = escapeXPathString(searchText);
        const xpath = tagName
          ? `//${tagName}[contains(text(), ${escaped})]`
          : `//*[contains(text(), ${escaped})]`;

        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );

        const elements: any[] = [];
        for (let i = 0; i < Math.min(result.snapshotLength, 100); i++) {
          const element = result.snapshotItem(i) as Element;
          if (!element) continue;

          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          // 生成选择器
          let selector = element.tagName.toLowerCase();
          if (element.id) {
            selector = `#${element.id}`;
          } else if (element.className) {
            const classes = element.className.split(' ').filter(c => c);
            if (classes.length > 0) {
              selector = `${element.tagName.toLowerCase()}.${classes[0]}`;
            }
          }

          elements.push({
            found: true,
            nodeName: element.tagName,
            textContent: element.textContent?.trim(),
            selector,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            visible: style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0',
          });
        }

        return elements;
      }, text, tag);

      logger.info(`findByText: "${text}" - found ${elements.length} elements`);
      return elements;
    } catch (error) {
      logger.error(`findByText failed for "${text}":`, error);
      return [];
    }
  }

  /**
   * 🆕 获取元素的XPath
   */
  async getXPath(selector: string): Promise<string | null> {
    try {
      const page = await this.collector.getActivePage();

      const xpath = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return null;
        }

        function getElementXPath(el: Element): string {
          if (el.id) {
            return `//*[@id="${el.id}"]`;
          }

          if (el === document.body) {
            return '/html/body';
          }

          let ix = 0;
          const siblings = el.parentNode?.children;
          if (siblings) {
            for (let i = 0; i < siblings.length; i++) {
              const sibling = siblings[i];
              if (!sibling) continue;

              if (sibling === el) {
                const parentPath = el.parentElement
                  ? getElementXPath(el.parentElement)
                  : '';
                return `${parentPath}/${el.tagName.toLowerCase()}[${ix + 1}]`;
              }
              if (sibling.tagName === el.tagName) {
                ix++;
              }
            }
          }

          return '';
        }

        return getElementXPath(element);
      }, selector);

      logger.info(`getXPath: ${selector} -> ${xpath}`);
      return xpath;
    } catch (error) {
      logger.error(`getXPath failed for ${selector}:`, error);
      return null;
    }
  }

  /**
   * 🆕 检查元素是否在视口内
   */
  async isInViewport(selector: string): Promise<boolean> {
    try {
      const page = await this.collector.getActivePage();

      const inViewport = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
      }, selector);

      logger.info(`isInViewport: ${selector} - ${inViewport}`);
      return inViewport;
    } catch (error) {
      logger.error(`isInViewport failed for ${selector}:`, error);
      return false;
    }
  }

  /**
   * 关闭CDP会话
   */
  async close(): Promise<void> {
    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
      logger.info('DOM Inspector CDP session closed');
    }
  }
}

