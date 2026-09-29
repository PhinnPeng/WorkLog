/**
 * 命令面的唯一定义（PRD 5.2.14、D6）。
 *
 * `describe` 的输出、commander 的注册、以及参数校验用的枚举**都从这份元数据生成**。
 * 门禁 C 断言"describe 声明的 flag 集合 === commander 实际注册的集合"；
 * 若这里与 program.ts 各写一份，那条断言必红 —— 它是"同源"唯一的可执行证明。
 *
 * 本文件刻意不出现任何错误码字符串字面量：码表由 errors.ts 单点持有，这里只做映射。
 */
import { Code, exitCodeOf, type Code as CodeT } from './errors.js';
import type { RenderKind } from './render.js';

export const CLI_VERSION = '0.1.0';

export interface FlagSpec {
  /** commander 风格的声明串，例如 '--db <path>' / '--pretty' */
  declaration: string;
  description: string;
  /** 取值范围（enum 型 flag 才给） */
  values?: readonly string[];
  /** 归属：全局层还是命令层（PRD 5.2.0） */
  scope: 'global' | 'command';
  /** 必填缺失由框架层拦下 → USAGE_ERROR、退出 2（5.7.3） */
  required?: boolean;
  /**
   * 是否让 commander 用 choices 拦截非法值。只给 --format 这类**调用方式**
   * 参数打开；业务枚举（--status／--item-type／--source）刻意不开，
   * 由命令层报 VALIDATION_ERROR、退出 1 —— 按 5.7.3"枚举值非法"属业务校验，
   * Agent 改参数即可重试，不该升级成用法错。
   */
  commanderChoices?: boolean;
}

export interface CommandSpec {
  name: string;
  description: string;
  flags: FlagSpec[];
  /** 该命令是否只读 —— doctor/describe 必须为 true（不开库） */
  readOnly: boolean;
  /** `--format table|markdown` 的数据体形态；describe/doctor 恒为 JSON */
  render?: RenderKind;
}

export const FORMATS = ['json', 'table', 'markdown'] as const;

/**
 * 字段枚举的单点定义（PRD 5.1.4）。`describe` 广告出去的取值与命令层实际
 * 接受的取值必须同源，否则自描述本身就成了一份假文档。
 */
export const ITEM_TYPES = ['log', 'plan'] as const;
export const STATUSES = ['planned', 'in_progress', 'done', 'blocked'] as const;
export const SOURCES = ['user', 'screenshot', 'import'] as const;

export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  {
    declaration: '--format <fmt>',
    description: '仅改变 stdout 数据体的呈现；不影响 stderr 错误对象',
    values: FORMATS,
    commanderChoices: true,
    scope: 'global',
  },
  { declaration: '--pretty', description: 'JSON 缩进 2 空格（默认单行紧凑）', scope: 'global' },
  { declaration: '--quiet', description: '抑制 stderr 的警告与提示（错误仍输出）', scope: 'global' },
  {
    declaration: '--db <path>',
    description: '本次运行临时指定数据库，不读写 data_dir 配置',
    scope: 'global',
  },
  { declaration: '--no-color', description: '关闭 stderr 着色', scope: 'global' },
];

/**
 * commander 自动注入、不由 spec 声明的选项（PRD 5.2.0 里同样面向用户）。
 * 显式列出来交给门禁 C 断言，而不是在比对时悄悄 filter 掉 ——
 * 抹掉就等于放弃了"这一层有没有意外多出东西"的检查。
 */
export const FRAMEWORK_FLAGS = ['--help', '--version'] as const;

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'describe',
    description: '导出命令面与契约的机器可读自描述（只读、不开库、库损坏时仍可用）',
    readOnly: true,
    flags: [],
  },
  {
    name: 'doctor',
    description: '环境与库自检（只读：不迁移、不修复、不改权限）',
    readOnly: true,
    flags: [{ declaration: '--json', description: '等价于 --format json（显式别名）', scope: 'command' }],
  },
  {
    name: 'add',
    description: '添加工作项或计划项（跨字段冲突一律报错，不静默纠正）',
    readOnly: false,
    render: 'item',
    flags: [
      {
        declaration: '--content <text>',
        description: '内容；传 - 表示从 stdin 读取（含引号／换行／超长时必用）',
        required: true,
        scope: 'command',
      },
      { declaration: '--item-type <t>', description: '类型，默认 log', values: ITEM_TYPES, scope: 'command' },
      { declaration: '--date <d>', description: '记录日期 YYYY-MM-DD，默认当天', scope: 'command' },
      { declaration: '--time <t>', description: '记录时刻 HH:MM，可选', scope: 'command' },
      { declaration: '--category <s>', description: '分类（自由文本；先跑 categories 取规范名）', scope: 'command' },
      { declaration: '--status <s>', description: '状态；缺省时 log→done、plan→planned', values: STATUSES, scope: 'command' },
      { declaration: '--source <s>', description: '来源，默认 user', values: SOURCES, scope: 'command' },
      { declaration: '--planned-for <d>', description: '计划归属日期 YYYY-MM-DD（仅 plan 合法）', scope: 'command' },
    ],
  },
  {
    name: 'list',
    description: '列出工作项，支持过滤、全序排序与分页',
    readOnly: false,
    render: 'envelope',
    flags: [
      { declaration: '--item-type <t>', description: '按类型过滤；缺省返回全部类型', values: ITEM_TYPES, scope: 'command' },
      {
        declaration: '--date <d>',
        description: '单日过滤。注意对 plan 过滤的是登记日 date，查某天的计划请用 --planned-for',
        scope: 'command',
      },
      { declaration: '--from <d>', description: '区间起（含）；与 --date 互斥', scope: 'command' },
      { declaration: '--to <d>', description: '区间止（含）；与 --date 互斥', scope: 'command' },
      { declaration: '--category <s>', description: '按分类精确过滤', scope: 'command' },
      { declaration: '--status <s>', description: '按状态过滤', values: STATUSES, scope: 'command' },
      {
        declaration: '--keyword <s>',
        description:
          'content 子串检索（LIKE，% _ 按字面匹配）。大小写：ASCII 不区分（api 命中 API），非 ASCII 区分（中文按字面）',
        scope: 'command',
      },
      { declaration: '--planned-for <d>', description: '查询归属某日的计划项', scope: 'command' },
      { declaration: '--overdue', description: 'plan 且 planned_for 早于今天且 status≠done', scope: 'command' },
      { declaration: '--limit <n>', description: '返回条数上限，默认 200（是否截断由信封 truncated 表达）', scope: 'command' },
      { declaration: '--offset <n>', description: '分页偏移，默认 0', scope: 'command' },
      { declaration: '--all', description: '取消条数上限（不提供 --limit 0 表示全部，避免歧义）', scope: 'command' },
      { declaration: '--include-deleted', description: '带出软删除墓碑', scope: 'command' },
    ],
  },
  {
    name: 'show',
    description: '按 id 精确读取单条（改前先读的原语）',
    readOnly: false,
    render: 'item',
    flags: [
      { declaration: '--id <id>', description: 'ULID 或其唯一前缀（不区分大小写）', required: true, scope: 'command' },
      { declaration: '--include-deleted', description: '允许读取软删除墓碑', scope: 'command' },
    ],
  },
  {
    name: 'search',
    description: '按关键词检索内容，与 list --keyword 同一实现',
    readOnly: false,
    render: 'envelope',
    flags: [
      {
        declaration: '--keyword <s>',
        description:
          '子串关键词；空白会报错而非退化成全表。大小写：ASCII 不区分，非 ASCII（中文）区分',
        required: true,
        scope: 'command',
      },
      { declaration: '--from <d>', description: '区间起（含）', scope: 'command' },
      { declaration: '--to <d>', description: '区间止（含）', scope: 'command' },
      { declaration: '--item-type <t>', description: '按类型过滤；缺省检索全部类型', values: ITEM_TYPES, scope: 'command' },
      { declaration: '--limit <n>', description: '返回条数上限，默认 200', scope: 'command' },
      { declaration: '--offset <n>', description: '分页偏移，默认 0', scope: 'command' },
      { declaration: '--all', description: '取消条数上限', scope: 'command' },
    ],
  },
  {
    name: 'categories',
    description: '列出已有分类及条目数，供录入前做分类归一化',
    readOnly: false,
    render: 'categories',
    flags: [
      { declaration: '--prefix <s>', description: '前缀查漏，判断是否已有近似分类', scope: 'command' },
    ],
  },
];

/**
 * `describe` 广告出去的 flag。5.2.14 的示例里字段名即契约（name／type／required／
 * values），所以这里在实现用的 declaration 之外补齐这三个名字 —— 只增字段属
 * minor，但少了 `name` 会让 AC-7 里"describe 的 flag 名与 --help 一致"这句
 * 没有可读取的对象。
 */
export interface PublicFlag extends FlagSpec {
  name: string;
  type: 'string' | 'enum' | 'boolean';
}

export interface DescribePayload {
  version: string;
  commands: Array<{ name: string; description: string; readonly: boolean; flags: PublicFlag[] }>;
  global_flags: PublicFlag[];
  error_codes: Array<{ code: CodeT; exit: number }>;
  exit_codes: Array<{ code: number; meaning: string }>;
  constraints: Array<Record<string, unknown>>;
  limits: Record<string, number>;
}

/** 退出码分档（PRD 5.7.2）—— 分档依据是"谁能修"。 */
export const EXIT_MEANINGS: ReadonlyArray<{ code: number; meaning: string }> = [
  { code: 0, meaning: 'ok_including_empty_result' },
  { code: 1, meaning: 'business_or_validation_agent_can_fix_params' },
  { code: 2, meaning: 'usage_error_agent_fix_invocation' },
  { code: 3, meaning: 'environment_stop_and_report_to_human' },
];

/**
 * 5.1.1 的跨字段规则。M0 阶段它们由 CLI 前置校验实现（D39），
 * 这里先声明，供 M1 的写命令与 describe 消费。
 */
export const CONSTRAINTS: DescribePayload['constraints'] = [
  { when: 'item_type=log', forbid: 'status=planned', error_code: Code.CONFLICT_STATUS_PLANNED_FOR_LOG },
  { when: 'item_type=log', forbid: 'planned_for IS NOT NULL', error_code: Code.CONFLICT_PLANNED_FOR_ON_LOG },
  {
    when: 'item_type=plan',
    require: 'planned_for IS NOT NULL',
    error_code: Code.CONFLICT_PLAN_MISSING_PLANNED_FOR,
  },
];

export const LIMITS = { content_max_chars: 2000, default_limit: 200, id_prefix_display: 12 };

/** 对外只暴露契约字段；`commanderChoices` 属注册细节，不进 describe 输出。 */
function publicFlag(f: FlagSpec): PublicFlag {
  const declaration = f.declaration;
  const name = declaration.split(' ')[0]!;
  const takesValue = /<[A-Za-z0-9_-]+>/.test(declaration);
  return {
    name,
    type: f.values ? 'enum' : takesValue ? 'string' : 'boolean',
    declaration,
    description: f.description,
    scope: f.scope,
    ...(f.values ? { values: f.values } : {}),
    ...(f.required ? { required: true } : {}),
  };
}

export function buildDescribe(): DescribePayload {
  const flags = (scope: 'global' | 'command') => GLOBAL_FLAGS.filter((f) => f.scope === scope);
  return {
    version: CLI_VERSION,
    commands: COMMANDS.map((c) => ({
      name: c.name,
      description: c.description,
      readonly: c.readOnly,
      flags: [...flags('global'), ...c.flags].map(publicFlag),
    })),
    global_flags: flags('global').map(publicFlag),
    error_codes: Object.values(Code)
      .map((code) => ({ code, exit: exitCodeOf(code) }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    exit_codes: [...EXIT_MEANINGS],
    constraints: CONSTRAINTS,
    limits: { ...LIMITS },
  };
}
