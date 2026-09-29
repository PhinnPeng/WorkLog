/**
 * 人类呈现层（PRD 5.6）。`--format table|markdown` 只改 stdout 数据体，
 * 错误对象恒为单行 JSON（5.2.1）—— 所以这里只被成功路径调用。
 *
 * 刻意不探测标准输出的列宽（门禁 A 禁止本文件触碰流）：列宽按 5.6
 * 的固定裁剪值走，TTY 自适应宽度尚未实现。
 */
import { LIMITS } from './spec.js';
import type { CategoryCount, PublicItem } from '../db/items.js';
import type { Envelope } from './commands/list.js';

const CONTENT_CLIP = 40;

/** 东亚宽字符按 2 列计，否则中文内容下表格必然错位。 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      c === 0x2329 ||
      c === 0x232a ||
      (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** 表格里的内容：换行先压成空格（否则破表），再按 40 字符裁剪。 */
function clipContent(s: string): string {
  const flat = s.replaceAll(/\s+/g, ' ').trim();
  return flat.length > CONTENT_CLIP ? `${flat.slice(0, CONTENT_CLIP)}…` : flat;
}

const HEADERS = ['ID', '日期', '类型', '分类', '状态', '内容'];
const WIDTHS = [LIMITS.id_prefix_display, 10, 4, 14, 11, CONTENT_CLIP];

function row(cells: string[]): string {
  return cells.map((c, i) => pad(c, WIDTHS[i]!)).join('  ');
}

function table(rowsText: string[]): string {
  const rule = row(WIDTHS.map((w) => '-'.repeat(w)));
  return [row(HEADERS), rule, ...rowsText].join('\n');
}

function itemRow(item: PublicItem): string {
  return row([
    item.id.slice(0, LIMITS.id_prefix_display),
    item.date,
    item.item_type,
    item.category ?? '-',
    item.status,
    clipContent(item.content),
  ]);
}

function itemMarkdown(item: PublicItem): string {
  const category = item.category ? ` (${item.category})` : '';
  return `- [${item.date}] ${clipContent(item.content)}${category}`;
}

export type RenderKind = 'item' | 'envelope' | 'categories';

const CATEGORY_COL = 14;

function categoryTable(list: CategoryCount[]): string {
  const head = `${pad('分类', CATEGORY_COL)}  ${pad('条目数', 7)}`;
  const rule = `${'-'.repeat(CATEGORY_COL)}  ${'-'.repeat(7)}`;
  const rows = list.map((c) => `${pad(c.category, CATEGORY_COL)}  ${String(c.count).padStart(7)}`);
  return [head, rule, ...rows].join('\n');
}

export function render(kind: RenderKind, data: unknown, format: string): string {
  if (kind === 'categories') {
    const list = data as CategoryCount[];
    if (list.length === 0) return '无记录';
    return format === 'markdown'
      ? list.map((c) => `- ${c.category}: ${c.count}`).join('\n')
      : categoryTable(list);
  }

  const items: PublicItem[] = kind === 'item' ? [data as PublicItem] : (data as Envelope).items;
  if (items.length === 0) return '无记录';

  if (format === 'markdown') return items.map(itemMarkdown).join('\n');

  let out = table(items.map(itemRow));
  if (kind === 'envelope') {
    const env = data as Envelope;
    if (env.truncated) {
      out += `\n… 结果被截断，用 --offset ${env.offset + env.items.length} 续取或提高 --limit`;
    }
  }
  return out;
}
