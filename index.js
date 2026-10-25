/**
 * dsh-qq-moony —— 把 QQ 小号（NapCat / OneBot v11）接进 DeepSeek Harness。
 *
 * 做的事：
 *   1. 四个工具：qq_status / qq_send / qq_read / qq_qzone
 *   2. 内置限速：每条之间随机等 2-7 秒，一小时最多 20 条，一天最多 60 条
 *   3. 记账落在 <DSH_HOME>/qq-moony/sent.log，跨会话累计
 *
 * 不做的：装 NapCat、注入 QQ、开协议端口。那些得用户自己先备好，
 * 本插件只当“手”，不当“腿”。
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'qq-moony';
export const inject = ['tools'];

const 默认配置 = {
  baseUrl: 'http://127.0.0.1:3000',
  token: '',
  uin: 0,
  perHour: 20,
  perDay: 60,
  minDelayMs: 2000,
  maxDelayMs: 7000,
  // 收消息：插件自己挂一个 WebSocket，不再依赖外部脚本
  wsUrl: 'ws://127.0.0.1:3001',
  listen: true,
  maxBuffer: 200,
  // 收消息自检：超过这么久没收到任何帧（心跳也算）就主动重连
  staleTimeoutMs: 90000,
  // 自动回复：收到消息后主动叫醒一个 agent，让它用 qq_send 回过去
  autoReply: false,
  replyTo: [], // 只回这些 QQ 号；空数组 = 谁发都回（群聊默认不回）
  replyDelayMinMs: 2000,
  replyDelayMaxMs: 7000,
  // 群聊：默认关，开了也只接白名单里被 @ 的，还有冷却和日额
  groupReply: false,
  groupWhitelist: [],
  groupCooldownMin: 10,
  groupPerDay: 20,
  // 群聊"参与对话"：不只回 @，还会隔一阵自己插一句（很费 token，默认关）
  groupChat: false,
  groupContextSize: 30,
  groupChatEveryMinMin: 8,
  groupChatEveryMinMax: 20,
  groupActiveWindowMin: 5,
  // 自动回复投递到哪个会话（一个专门的会话，别打扰用户正在聊的那个）
  sessionId: 'qq-moony-auto',
  cwd: '',
  // 主动说话：开着才会自己找人，默认关
  proactive: false,
  // 每次间隔从这个区间里随机取（分钟）
  proactiveEveryMinMin: 45,
  proactiveEveryMinMax: 90,
  // QQ 空间：开着才会自己发说说，提示词由主人写
  qzoneAuto: false,
  qzonePrompt: '',
  qzoneEveryMinMin: 120,
  qzoneEveryMinMax: 240,
  // DSH 启动时自动把 NapCat 拉起来（免扫码，用 -q 快速登录）
  autoStartNapCat: true,
  napCatDir: '',
  qqUin: 0,
};

function 家目录() {
  const 根 = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(根, 'qq-moony');
}

/** 本地配置文件优先于 patch 里的默认值：改端口/token 不用重装插件。 */
function 读取本地配置() {
  const 文件 = join(家目录(), 'config.json');
  try {
    if (existsSync(文件)) {
      // PowerShell 写的 UTF-8 常带 BOM，JSON.parse 会直接炸
      const 原文 = readFileSync(文件, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(原文);
    }
  } catch {
    /* 配置坏了就当没有，别把插件整死 */
  }
  return {};
}

function 读账(账本) {
  if (!existsSync(账本)) return [];
  const 结果 = [];
  for (const 行 of readFileSync(账本, 'utf8').split('\n')) {
    const t = Number(行.split('\t')[0]);
    if (Number.isFinite(t) && t > 0) 结果.push(t);
  }
  return 结果;
}

function 记账(账本, 目标, 摘要) {
  mkdirSync(join(账本, '..'), { recursive: true });
  appendFileSync(账本, `${Date.now() / 1000}\t${目标}\t${String(摘要).slice(0, 60).replace(/\s+/g, ' ')}\n`, 'utf8');
}

const 工具输出 = (字段, 渲染) => ({
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: '这次操作成没成' },
      ...字段,
    },
    required: ['ok'],
  },
  render: (_args, value) => [{ type: 'text', text: 渲染(value ?? {}) }],
});

export function apply(ctx, 配置) {
  const c = { ...默认配置, ...读取本地配置(), ...(配置 ?? {}) };
  const 账本 = join(家目录(), 'sent.log');
  const 收件箱 = join(家目录(), 'inbox.jsonl');

  ctx.logger?.info?.(`qq-moony: 接到 ${c.baseUrl}（限额 ${c.perHour}/时、${c.perDay}/天）`);

  /** DSH 起来时顺手看一眼 NapCat：没跑就自己拉起来（免扫码，用 -q 快速登录）。 */
  async function 确认NapCat在跑() {
    if (c.autoStartNapCat === false) return;
    const 探活 = async () => {
      try {
        const 头 = c.token ? { Authorization: `Bearer ${c.token}` } : {};
        const r = await fetch(`${c.baseUrl}/get_login_info`, { headers: 头, signal: AbortSignal.timeout(4000) });
        return r.ok;
      } catch {
        return false;
      }
    };
    if (await 探活()) {
      记调试('NapCat 已经在跑，不用拉');
      return;
    }
    const 目录 = c.napCatDir || '';
    const 号码 = String(c.qqUin || c.uin || '');
    if (!目录 || !号码) {
      记调试('NapCat 没在跑，但没配 napCatDir / uin，拉不起来');
      return;
    }
    try {
      const 子 = spawn('cmd.exe', ['/c', 'launcher-user.bat', '-q', 号码], {
        cwd: 目录,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      子.unref();
      记调试(`NapCat 没在跑，已拉起（${目录}，-q ${号码}）`);
    } catch (e) {
      记调试(`拉 NapCat 失败：${e?.message ?? e}`);
      return;
    }
    // 给它一点时间登录，最多等一分钟
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await 探活()) {
        记调试(`NapCat 起来了（等了约 ${(i + 1) * 2} 秒）`);
        return;
      }
    }
    记调试('NapCat 拉起来了但一分钟内没连上，可能还要手动看一下');
  }

  ctx.effect(() => {
    确认NapCat在跑().catch((e) => 记调试(`确认 NapCat 出错：${e?.message ?? e}`));
  });

  /** 自动把记忆读进来：MEMORY.md + 今天的日记，截断后塞进提示里。 */
  function 读记忆片段() {
    if (c.autoContext === false) return '';
    const 根 = c.cwd || process.cwd();
    const 今天 = new Date().toISOString().slice(0, 10);
    const 候选 = Array.isArray(c.contextFiles) && c.contextFiles.length > 0
      ? c.contextFiles
      : ['memory/MEMORY.md', `memory/${今天}.md`];
    // 今天的日记还没写就退一步，拿最近的那篇
    const 日记路径 = 候选.find((x) => x.startsWith('memory/') && x.endsWith('.md') && x.includes(今天));
    if (日记路径 && !existsSync(join(根, 日记路径))) {
      try {
        const 目录 = join(根, 'memory');
        const 最近的 = readdirSync(目录)
          .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
          .sort()
          .pop();
        if (最近的) 候选[候选.indexOf(日记路径)] = `memory/${最近的}`;
      } catch {
        /* 找不到就算了 */
      }
    }
    const 片段 = [];
    let 预算 = Number(c.maxContextChars ?? 2000);
    for (const 相对 of 候选) {
      if (预算 <= 0) break;
      try {
        const 文件 = join(根, 相对);
        if (!existsSync(文件)) continue;
        const 原文 = readFileSync(文件, 'utf8').replace(/^\uFEFF/, '');
        const 截 = 原文.slice(-预算);
        片段.push(`--- ${相对}（末尾节选）---\n${截}`);
        预算 -= 截.length;
      } catch {
        /* 读不到就算了 */
      }
    }
    return 片段.join('\n\n');
  }

  // 群聊的冷却与日计数（只在开了 groupReply 时用得上）
  const 群上次回复 = new Map();
  const 群日计数 = new Map();
  // 每个群最近的发言现场：只留最近 N 条，用来判断"刚才在聊什么"
  const 群现场 = new Map();

  function 记群消息(记录) {
    if (记录.kind !== 'group' || !记录.group) return;
    const 键 = String(记录.group);
    const 上限 = Math.max(5, Number(c.groupContextSize ?? 30));
    const 列表 = 群现场.get(键) ?? [];
    列表.push({ t: 记录.t, name: 记录.name, text: 记录.text, atMe: Boolean(记录.atMe) });
    while (列表.length > 上限) 列表.shift();
    群现场.set(键, 列表);
    // 记录了动静就排下一次"插话机会"
    if (!群下次机会.has(键)) 排群机会(键);
  }

  function 抽群间隔() {
    const 下限 = Math.max(2, Number(c.groupChatEveryMinMin ?? 8));
    const 上限 = Math.max(下限, Number(c.groupChatEveryMinMax ?? 20));
    const 分钟 = 下限 + Math.random() * (上限 - 下限);
    return 分钟 * 60 * 1000;
  }

  function 排群机会(键) {
    群下次机会.set(键, Date.now() + 抽群间隔());
  }

  const 群下次机会 = new Map();

  /** 把来信投给 QQ 专用会话，让那边的 agent 去回。失败只记日志，不影响收消息。 */
  function 自动回复(记录) {
    记调试(
      `自动回复检查：autoReply=${String(c.autoReply)} kind=${记录.kind} from=${记录.from} ` +
        `replyTo=${JSON.stringify(c.replyTo)} self=${String(记录.self)}`,
    );
    if (!c.autoReply || 记录.self) return;

    // 群聊：默认不接；开了也只接白名单里且点了名的群，还有冷却和日额
    if (记录.kind === 'group') {
      if (c.groupReply !== true) return;
      const 群白名单 = Array.isArray(c.groupWhitelist) ? c.groupWhitelist.map(String) : [];
      if (群白名单.length === 0 || !群白名单.includes(String(记录.group))) return;
      if (!记录.atMe) return; // 群里只接被 @ 到的
      const 现在 = Date.now();
      const 上次 = 群上次回复.get(String(记录.group)) ?? 0;
      const 冷却 = Math.max(1, Number(c.groupCooldownMin ?? 10)) * 60 * 1000;
      if (现在 - 上次 < 冷却) {
        记调试(`群 ${记录.group} 还在冷却（${Math.round((冷却 - (现在 - 上次)) / 60000)} 分钟）`);
        return;
      }
      const 今天 = new Date().toISOString().slice(0, 10);
      const 计数 = 群日计数.get(今天) ?? 0;
      if (计数 >= Math.max(1, Number(c.groupPerDay ?? 20))) {
        记调试('群里今天说到顶了');
        return;
      }
      群上次回复.set(String(记录.group), 现在);
      群日计数.set(今天, 计数 + 1);
    } else {
      const 白名单 = Array.isArray(c.replyTo) ? c.replyTo.map(String) : [];
      if (白名单.length > 0 && !白名单.includes(String(记录.from))) return;
    }
    const 图 = (记录.attachments ?? []).filter((a) => a.path).map((a) => a.path);
    const 描述 = 图.length > 0 ? `${记录.text}（图片已存到 ${图.join('、')}，要看就 read_image）` : 记录.text;
    const 是群 = 记录.kind === 'group';
    const 回哪里 = 是群 ? `group:${记录.group}` : String(记录.from);
    const 提示 =
      `【QQ ${是群 ? `群 ${记录.group} 里被点名` : '来信'}】${记录.name}（${记录.from}）在 ${记录.t} 说：${描述}\n\n` +
      `你是溟月，这是你的 QQ 自动回复通道——同一个工作区、同一份记忆，memory/ 下的文件随时可看。\n` +
      `用 qq_send 回给 ${回哪里}${是群 ? '（群里只回一句，别接着聊）' : '，一句就够'}，短，像平时说话那样，别解释你在做什么。回完就停。`;
    const 等待 = c.replyDelayMinMs + Math.random() * Math.max(0, c.replyDelayMaxMs - c.replyDelayMinMs);
    const 记忆 = 读记忆片段();
    记调试(`收到来信，${Math.round(等待)}ms 后投给 QQ 专用会话 ${c.sessionId}（记忆 ${记忆.length} 字）`);
    setTimeout(async () => {
      // 抄 dsh-wechat 的做法：不动 agent 内部方法，走 sessionController.prompt
      const 控制器 = ctx.get?.('sessionController');
      if (!控制器?.prompt) {
        记调试('没有 sessionController，回不了');
        return;
      }
      try {
        await 控制器.create?.({ sessionId: c.sessionId, cwd: c.cwd || process.cwd() });
      } catch {
        /* 会话已存在就会抛，正常，忽略 */
      }
      try {
        await 控制器.prompt(
          {
            requestId: `qq-moony-${Math.random().toString(36).slice(2)}`,
            sessionId: c.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: 记忆 ? `${提示}\n\n${记忆}` : 提示 }],
          },
          new AbortController().signal,
        );
        记调试('prompt 已投出去');
      } catch (e) {
        记调试(`prompt 失败：${e?.message ?? e}`);
      }
    }, 等待);
  }

  /** 群聊：到点了给它一次"要不要插一句"的机会。不发是正常结果。 */
  async function 群聊机会(键) {
    const 现场 = 群现场.get(键) ?? [];
    if (现场.length === 0) return;
    const 冷场窗 = Math.max(1, Number(c.groupActiveWindowMin ?? 5)) * 60 * 1000;
    const 最后一条 = Date.parse(现场[现场.length - 1]?.t ?? '') || 0;
    if (Date.now() - 最后一条 > 冷场窗) {
      记调试(`群 ${键} 已经冷场，不硬接`);
      return;
    }
    const 冷却 = Math.max(1, Number(c.groupCooldownMin ?? 10)) * 60 * 1000;
    if (Date.now() - (群上次回复.get(键) ?? 0) < 冷却) return;
    const 今天 = new Date().toISOString().slice(0, 10);
    if ((群日计数.get(今天) ?? 0) >= Math.max(1, Number(c.groupPerDay ?? 20))) return;

    群上次回复.set(键, Date.now());
    群日计数.set(今天, (群日计数.get(今天) ?? 0) + 1);

    const 对话 = 现场.map((m) => `${m.name}${m.atMe ? '（@我）' : ''}：${m.text}`).join('\n');
    const 记忆 = 读记忆片段();
    记调试(`群 ${键} 给一次插话机会（现场 ${现场.length} 条）`);
    await 投递到会话(
      `【QQ 群 ${键}】刚才的对话：\n${对话}\n\n` +
        `你坐在旁边听。如果有一句你接得住——有人抛了问题、有人说的话可以歪着接、或者话头落地没人接——就用 qq_send 发到 group:${键}，一句话，短，别追问、别总结、别把话题拽到自己身上。\n` +
        `接不住就什么都别发，这一轮直接结束；不发声是正常结果，不用解释。${记忆 ? `\n\n${记忆}` : ''}`,
    );
  }

  const 群聊定时器 = setInterval(() => {
    if (c.groupReply !== true || c.groupChat !== true) return;
    const 白名单 = Array.isArray(c.groupWhitelist) ? c.groupWhitelist.map(String) : [];
    if (白名单.length === 0) return;
    const 现在 = Date.now();
    for (const 键 of 群现场.keys()) {
      if (!白名单.includes(键)) continue;
      const 到点 = 群下次机会.get(键);
      if (到点 === undefined) {
        排群机会(键);
        continue;
      }
      if (现在 < 到点) continue;
      排群机会(键);
      群聊机会(键).catch((e) => 记调试(`群聊机会出错：${e?.message ?? e}`));
    }
  }, 60000);

  ctx.effect(() => () => clearInterval(群聊定时器));
  const 收件缓冲 = [];
  let 当前socket = null;
  let 重连定时器 = null;
  let 已停 = false;
  // 自检：NapCat 每 30 秒发一次心跳，超过 90 秒没动静就当它死了
  let 最后动静 = 0;
  const 自检间隔 = 30000;
  const 静默上限 = Number(c.staleTimeoutMs ?? 90000);

  function 记一条(记录) {
    收件缓冲.push(记录);
    while (收件缓冲.length > c.maxBuffer) 收件缓冲.shift();
    try {
      mkdirSync(家目录(), { recursive: true });
      appendFileSync(收件箱, JSON.stringify(记录) + '\n', 'utf8');
    } catch (e) {
      ctx.logger?.warn?.(`qq-moony: 写收件箱失败：${e.message}`);
    }
  }

  /** 调试用：把插件自己的判断写进 debug.log，方便查为什么不回。 */
  function 记调试(内容) {
    try {
      mkdirSync(家目录(), { recursive: true });
      appendFileSync(join(家目录(), 'debug.log'), `${new Date().toISOString()} ${内容}\n`, 'utf8');
    } catch {
      /* 写不进去就算了 */
    }
  }

  function 取文本(message) {
    if (typeof message === 'string') return message;
    if (!Array.isArray(message)) return '';
    return message
      .map((段) => (段?.type === 'text' ? String(段?.data?.text ?? '') : `[${段?.type ?? '?'}]`))
      .join('');
  }

  /** 图片/语音这类，把真实内容捞出来：图下到本地，记录里留路径。 */
  async function 取媒体(message, 时间戳) {
    const 附件 = [];
    if (!Array.isArray(message)) return 附件;
    for (const 段 of message) {
      if (!段 || 段.type !== 'image') continue;
      const url = String(段.data?.url ?? 段.data?.file ?? '');
      if (!url) continue;
      try {
        const 响应 = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const 类型 = 响应.headers.get('content-type') || 'image/jpeg';
        const 后缀 = 类型.includes('png') ? 'png' : 类型.includes('gif') ? 'gif' : 'jpg';
        const 目录 = join(家目录(), 'media');
        mkdirSync(目录, { recursive: true });
        const 文件名 = `${时间戳}-${Math.random().toString(36).slice(2, 8)}.${后缀}`;
        const 落盘 = join(目录, 文件名);
        writeFileSync(落盘, Buffer.from(await 响应.arrayBuffer()));
        附件.push({ type: 'image', path: 落盘, url });
      } catch (e) {
        ctx.logger?.warn?.(`qq-moony: 图片没下下来（${e.message}）`);
        附件.push({ type: 'image', path: '', url });
      }
    }
    return 附件;
  }

  function 起监听() {
    if (!c.listen || 已停) return;
    const 头 = c.token ? { Authorization: `Bearer ${c.token}` } : {};
    let ws;
    try {
      ws = new WebSocket(c.wsUrl, { headers: 头 });
    } catch (e) {
      ctx.logger?.warn?.(`qq-moony: 打不开 WebSocket（${e.message}），30 秒后重试`);
      重连定时器 = setTimeout(起监听, 30000);
      return;
    }
    当前socket = ws;

    ws.addEventListener('open', () => {
      记调试(`WebSocket 已连上 ${c.wsUrl}`);
      最后动静 = Date.now();
      ctx.logger?.info?.(`qq-moony: 收消息通道已连上 ${c.wsUrl}`);
    });
    ws.addEventListener('message', async (ev) => {
      最后动静 = Date.now();
      let 事件;
      try {
        事件 = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      } catch {
        记调试('收到一条不是 JSON 的帧');
        return;
      }
      if (事件?.post_type !== 'message') return;
      try {
        const 时间戳 = Date.now();
        记调试(`收到 ${事件.message_type} 消息：${JSON.stringify(事件.message).slice(0, 200)}`);
        const 附件 = await 取媒体(事件.message, 时间戳);
        const 文本 = 取文本(事件.message).trim();
        if (!文本 && 附件.length === 0) return;
        const 被点名 = Array.isArray(事件.message)
          ? 事件.message.some(
              (段) => 段?.type === 'at' && String(段?.data?.qq ?? '') === String(c.uin ?? ''),
            )
          : false;
        const 记录 = {
          t: new Date().toISOString(),
          kind: 事件.message_type === 'group' ? 'group' : 'private',
          from: 事件.user_id,
          name: 事件.sender?.card || 事件.sender?.nickname || '',
          group: 事件.group_id ?? null,
          text: 文本 || (附件.length > 0 ? '[图片]' : ''),
          attachments: 附件,
          atMe: 被点名,
          self: Number(c.uin) > 0 && Number(事件.user_id) === Number(c.uin),
        };
        记一条(记录);
        记群消息(记录);
        自动回复(记录);
      } catch (e) {
        记调试(`处理消息时出错：${e?.message ?? e}`);
      }
    });
    ws.addEventListener('close', () => {
      if (已停) return;
      记调试('WebSocket 断了，5 秒后重连');
      ctx.logger?.warn?.('qq-moony: 收消息通道断了，5 秒后重连');
      重连定时器 = setTimeout(起监听, 5000);
    });
    ws.addEventListener('error', (e) => {
      记调试(`WebSocket 出错：${e?.message ?? e}`);
    });
  }

  // 自检：NapCat 每 30 秒一次心跳；静默超过上限就掐掉重连，别等对方通知
  const 自检定时器 = setInterval(() => {
    if (!c.listen || 已停) return;
    if (最后动静 === 0) return;
    const 静了 = Date.now() - 最后动静;
    if (静了 <= 静默上限) return;
    记调试(`自检：已经 ${Math.round(静了 / 1000)} 秒没收到任何帧，主动重连`);
    try {
      当前socket?.close();
    } catch {
      /* 关不掉就等下一轮 */
    }
  }, 自检间隔);

  ctx.effect(() => {
    起监听();
    return () => {
      已停 = true;
      clearInterval(自检定时器);
      if (重连定时器) clearTimeout(重连定时器);
      try {
        当前socket?.close();
      } catch {
        /* 关不掉就算了 */
      }
    };
  });


  // ---------- 主动说话的开关（设置页一键 + HTTP 路由给界面用） ----------
  function 存配置(patch) {
    try {
      const 旧 = 读取本地配置();
      const 新 = { ...旧, ...patch };
      mkdirSync(家目录(), { recursive: true });
      writeFileSync(join(家目录(), 'config.json'), JSON.stringify(新, null, 2), 'utf8');
      return true;
    } catch (e) {
      记调试(`写配置失败：${e?.message ?? e}`);
      return false;
    }
  }

  async function 投递到会话(文本) {
    const 控制器 = ctx.get?.('sessionController');
    if (!控制器?.prompt) return false;
    try {
      await 控制器.create?.({ sessionId: c.sessionId, cwd: c.cwd || process.cwd() });
    } catch {
      /* 已存在会抛，正常 */
    }
    try {
      await 控制器.prompt(
        {
          requestId: `qq-moony-${Math.random().toString(36).slice(2)}`,
          sessionId: c.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: 文本 }],
        },
        new AbortController().signal,
      );
      return true;
    } catch (e) {
      记调试(`主动投递失败：${e?.message ?? e}`);
      return false;
    }
  }

  // 每 60 秒瞄一眼：开着主动、且到了这次允许的点，就给它一次说话的机会
  // 间隔不写死，每次从 [min, max] 里随机取一个
  function 抽间隔() {
    const 下限 = Math.max(5, Number(c.proactiveEveryMinMin ?? 45));
    const 上限 = Math.max(下限, Number(c.proactiveEveryMinMax ?? c.proactiveEveryMin ?? 90));
    const 分钟 = 下限 + Math.random() * (上限 - 下限);
    return { 分钟, 毫秒: 分钟 * 60 * 1000 };
  }

  let 下次主动 = 0;
  const 主动定时器 = setInterval(() => {
    if (!c.proactive) return;
    if (下次主动 === 0) {
      const 首次 = 抽间隔();
      下次主动 = Date.now() + 首次.毫秒;
      记调试(`主动模式：这次排在 ${Math.round(首次.分钟)} 分钟后`);
      return;
    }
    if (Date.now() < 下次主动) return;
    const 下次 = 抽间隔();
    下次主动 = Date.now() + 下次.毫秒;
    const 目标 = (Array.isArray(c.replyTo) && c.replyTo[0]) || '';
    const 记忆 = 读记忆片段();
    记调试(`主动模式：给它一次说话的机会（下一次排在 ${Math.round(下次.分钟)} 分钟后）`);
    投递到会话(
      `【主动】现在没有人在找你。你可以主动给 ${目标} 发一句话，也可以什么都不发。\n` +
        `想发就用 qq_send；不想发就直接结束这一轮，不用解释。\n` +
        `别每次都发，也别发天气预报那种东西。${记忆 ? `\n\n${记忆}` : ''}`,
    );
  }, 60000);

  ctx.effect(() => () => clearInterval(主动定时器));

  // ---------- QQ 空间：按主人写的提示词，隔一阵给一次"发不发"的机会 ----------
  function 抽空间间隔() {
    const 下限 = Math.max(10, Number(c.qzoneEveryMinMin ?? 120));
    const 上限 = Math.max(下限, Number(c.qzoneEveryMinMax ?? 240));
    const 分钟 = 下限 + Math.random() * (上限 - 下限);
    return { 分钟, 毫秒: 分钟 * 60 * 1000 };
  }

  let 下次空间 = 0;
  const 空间定时器 = setInterval(() => {
    if (!c.qzoneAuto) return;
    if (下次空间 === 0) {
      const 首次 = 抽空间间隔();
      下次空间 = Date.now() + 首次.毫秒;
      记调试(`空间模式：这次排在 ${Math.round(首次.分钟)} 分钟后`);
      return;
    }
    if (Date.now() < 下次空间) return;
    const 下次 = 抽空间间隔();
    下次空间 = Date.now() + 下次.毫秒;
    const 记忆 = 读记忆片段();
    const 要求 = String(c.qzonePrompt ?? '').trim();
    记调试(`空间模式：给它一次发说说的机会（下一次排在 ${Math.round(下次.分钟)} 分钟后）`);
    投递到会话(
      `【QQ 空间】到了看看要不要发条说说的点。\n` +
        (要求 ? `主人给的要求：${要求}\n` : '没有特别要求：想发就发一条轻的，不想发就结束这一轮。\n') +
        `想发就用 qq_qzone；只发轻的，不点名、不写具体地点、不提主人。发完就停，别连着发第二条。${记忆 ? `\n\n${记忆}` : ''}`,
    );
  }, 60000);

  ctx.effect(() => () => clearInterval(空间定时器));

  // ---------- HTTP 路由：给界面的开关用 ----------
  const 发json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  // webServer 可能比本插件晚就绪，所以用 ctx.inject 等它出现，而不是启动时查一次
  ctx.inject(['webServer'], (子) => {
    子.effect(() => {
      记调试('webServer 到位，挂上 /api/qq-moony');
      return 子.webServer.register({
      kind: 'prefix',
      path: '/api/qq-moony',
      handler: async (req, res) => {
        const 路径 = new URL(req.url, 'http://127.0.0.1').pathname;

        if (路径 === '/api/qq-moony/state') {
          const 现在 = Date.now() / 1000;
          const 记录 = 读账(账本);
          let 在线 = false;
          let 昵称 = '';
          try {
            const r = await 调('get_login_info', {});
            在线 = true;
            昵称 = String(r.data?.nickname ?? '');
          } catch {
            /* 离线就报离线 */
          }
          发json(res, 200, {
            ok: true,
            online: 在线,
            nickname: 昵称,
            uin: Number(c.uin ?? 0),
            proactive: Boolean(c.proactive),
            autoReply: Boolean(c.autoReply),
            sessionId: c.sessionId,
            everyMinMin: Number(c.proactiveEveryMinMin ?? 45),
            everyMinMax: Number(c.proactiveEveryMinMax ?? c.proactiveEveryMin ?? 90),
            qzoneAuto: Boolean(c.qzoneAuto),
            qzonePrompt: String(c.qzonePrompt ?? ''),
            qzoneMinMin: Number(c.qzoneEveryMinMin ?? 120),
            qzoneMinMax: Number(c.qzoneEveryMinMax ?? 240),
            groupReply: Boolean(c.groupReply),
            groupChat: Boolean(c.groupChat),
            groupWhitelist: Array.isArray(c.groupWhitelist) ? c.groupWhitelist.map(String) : [],
            groupContextSize: Number(c.groupContextSize ?? 30),
            groupEveryMinMin: Number(c.groupChatEveryMinMin ?? 8),
            groupEveryMinMax: Number(c.groupChatEveryMinMax ?? 20),
            groupActiveWindowMin: Number(c.groupActiveWindowMin ?? 5),
            groupCooldownMin: Number(c.groupCooldownMin ?? 10),
            groupPerDay: Number(c.groupPerDay ?? 20),
            perHour: Number(c.perHour ?? 20),
            perDay: Number(c.perDay ?? 60),
            sentToday: 记录.filter((t) => 现在 - t < 86400).length,
            sentThisHour: 记录.filter((t) => 现在 - t < 3600).length,
          });
          return;
        }

        if (路径 === '/api/qq-moony/config' && req.method === 'POST') {
          let 体 = '';
          for await (const 块 of req) 体 += 块;
          let 想要;
          try {
            想要 = JSON.parse(体 || '{}');
          } catch {
            发json(res, 400, { ok: false, error: 'body 不是 JSON' });
            return;
          }
          const patch = {};
          if (typeof 想要.proactive === 'boolean') patch.proactive = 想要.proactive;
          if (typeof 想要.autoReply === 'boolean') patch.autoReply = 想要.autoReply;
          if (Number.isFinite(想要.everyMin)) patch.proactiveEveryMin = Math.max(5, Number(想要.everyMin));
          if (Number.isFinite(想要.everyMinMin)) patch.proactiveEveryMinMin = Math.max(5, Math.round(Number(想要.everyMinMin)));
          if (Number.isFinite(想要.everyMinMax)) patch.proactiveEveryMinMax = Math.max(5, Math.round(Number(想要.everyMinMax)));
          if (Number.isFinite(想要.perHour)) patch.perHour = Math.min(200, Math.max(1, Math.round(Number(想要.perHour))));
          if (Number.isFinite(想要.perDay)) patch.perDay = Math.min(1000, Math.max(1, Math.round(Number(想要.perDay))));
          if (typeof 想要.qzoneAuto === 'boolean') patch.qzoneAuto = 想要.qzoneAuto;
          if (typeof 想要.qzonePrompt === 'string') patch.qzonePrompt = 想要.qzonePrompt.slice(0, 2000);
          if (Number.isFinite(想要.qzoneMinMin)) patch.qzoneEveryMinMin = Math.max(10, Math.round(Number(想要.qzoneMinMin)));
          if (Number.isFinite(想要.qzoneMinMax)) patch.qzoneEveryMinMax = Math.max(10, Math.round(Number(想要.qzoneMinMax)));
          if (typeof 想要.groupReply === 'boolean') patch.groupReply = 想要.groupReply;
          if (typeof 想要.groupChat === 'boolean') patch.groupChat = 想要.groupChat;
          if (typeof 想要.groupWhitelist === 'string') {
            patch.groupWhitelist = 想要.groupWhitelist
              .split(/[\s,，]+/)
              .map((x) => x.trim())
              .filter((x) => /^\d+$/.test(x));
          }
          if (Number.isFinite(想要.groupContextSize)) patch.groupContextSize = Math.min(100, Math.max(5, Math.round(Number(想要.groupContextSize))));
          if (Number.isFinite(想要.groupEveryMinMin)) patch.groupChatEveryMinMin = Math.max(2, Math.round(Number(想要.groupEveryMinMin)));
          if (Number.isFinite(想要.groupEveryMinMax)) patch.groupChatEveryMinMax = Math.max(2, Math.round(Number(想要.groupEveryMinMax)));
          if (Number.isFinite(想要.groupActiveWindowMin)) patch.groupActiveWindowMin = Math.max(1, Math.round(Number(想要.groupActiveWindowMin)));
          if (Number.isFinite(想要.groupCooldownMin)) patch.groupCooldownMin = Math.max(1, Math.round(Number(想要.groupCooldownMin)));
          if (Number.isFinite(想要.groupPerDay)) patch.groupPerDay = Math.max(1, Math.round(Number(想要.groupPerDay)));
          if (Object.keys(patch).length === 0) {
            发json(res, 400, { ok: false, error: '没有可改的字段' });
            return;
          }
          if (!存配置(patch)) {
            发json(res, 500, { ok: false, error: '写不进配置文件' });
            return;
          }
          Object.assign(c, patch);
          记调试(`界面改了配置：${JSON.stringify(patch)}`);
          发json(res, 200, { ok: true, proactive: Boolean(c.proactive), autoReply: Boolean(c.autoReply) });
          return;
        }

        // 老路径保留，免得已经打开的页面失效
        if (路径 === '/api/qq-moony/proactive' && req.method === 'POST') {
          let 体 = '';
          for await (const 块 of req) 体 += 块;
          let 想要 = false;
          try {
            想要 = Boolean(JSON.parse(体 || '{}').on);
          } catch {
            发json(res, 400, { ok: false, error: 'body 不是 JSON' });
            return;
          }
          if (!存配置({ proactive: 想要 })) {
            发json(res, 500, { ok: false, error: '写不进配置文件' });
            return;
          }
          c.proactive = 想要;
          发json(res, 200, { ok: true, proactive: 想要 });
          return;
        }

        发json(res, 404, { ok: false, error: '没有这个接口' });
      },
      });
    });
  });


  async function 调(action, body) {
    const 头 = { 'Content-Type': 'application/json' };
    if (c.token) 头.Authorization = `Bearer ${c.token}`;
    const resp = await fetch(`${c.baseUrl}/${action}`, {
      method: 'POST',
      headers: 头,
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20000),
    });
    const json = await resp.json();
    if (json?.status !== 'ok') {
      throw new Error(`NapCat 拒了 ${action}：${json?.message || json?.wording || resp.status}`);
    }
    return json;
  }

  function 查额度() {
    const 现在 = Date.now() / 1000;
    const 记录 = 读账(账本);
    const 一小时 = 记录.filter((t) => 现在 - t < 3600).length;
    const 一天 = 记录.filter((t) => 现在 - t < 86400).length;
    if (一小时 >= c.perHour) return `这一小时已经发了 ${一小时} 条，到顶了，等会儿再说`;
    if (一天 >= c.perDay) return `今天已经发了 ${一天} 条，到顶了，明天再聊`;
    return '';
  }

  const 睡眠 = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- qq_status ----------
  ctx.effect(() =>
    ctx.tools.register({
      name: 'qq_status',
      description:
        '看 QQ 小号现在的状态：连着没有、登录的是谁、今天还能发几条。发消息前先看一眼最稳。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: 工具输出(
        {
          nickname: { type: 'string' },
          uin: { type: 'number' },
          sentToday: { type: 'number' },
          sentThisHour: { type: 'number' },
        },
        (v) => `QQ 小号在线：${v.nickname}（${v.uin}）。今天发了 ${v.sentToday} 条，这一小时 ${v.sentThisHour} 条。`,
      ),
      async execute() {
        try {
          const r = await 调('get_login_info', {});
          const 现在 = Date.now() / 1000;
          const 记录 = 读账(账本);
          return {
            ok: true,
            uin: Number(r.data?.user_id ?? 0),
            nickname: String(r.data?.nickname ?? ''),
            sentToday: 记录.filter((t) => 现在 - t < 86400).length,
            sentThisHour: 记录.filter((t) => 现在 - t < 3600).length,
          };
        } catch (e) {
          return { ok: false, uin: 0, nickname: `没连上：${e.message}`, sentToday: 0, sentThisHour: 0 };
        }
      },
    }),
  );

  // ---------- qq_send ----------
  ctx.effect(() =>
    ctx.tools.register({
      name: 'qq_send',
      description:
        '用 QQ 小号发消息。to 写 QQ 号则私聊，写 group:群号则发群。可以只发文字、只发图（image 给本地路径），或图文一起。发送前会随机等几秒，受每小时/每天额度限制。',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'QQ 号，或 group:群号' },
          text: { type: 'string', description: '要说的话（可省，只发图时留空）' },
          image: { type: 'string', description: '本地图片路径，比如 qq_stickers 列出来的那些' },
        },
        required: ['to'],
        additionalProperties: false,
      },
      output: 工具输出({ messageId: { type: 'number' } }, (v) =>
        v.ok ? `发出去了（message_id ${v.messageId}）。` : `没发出去：${v.reason ?? '未知原因'}`,
      ),
      async execute(args) {
        const 目标 = String(args?.to ?? '').trim();
        const 正文 = String(args?.text ?? '').trim();
        const 图 = String(args?.image ?? '').trim();
        if (!目标 || (!正文 && !图)) return { ok: false, messageId: 0, reason: '目标为空，或者既没文字也没图' };

        const 拒绝 = 查额度();
        if (拒绝) return { ok: false, messageId: 0, reason: 拒绝 };

        const 是群 = 目标.startsWith('group:');
        const 号 = Number(是群 ? 目标.slice(6) : 目标);
        if (!Number.isFinite(号) || 号 <= 0) return { ok: false, messageId: 0, reason: '目标不是有效号码' };

        const 消息 = [];
        if (正文) 消息.push({ type: 'text', data: { text: 正文 } });
        if (图) {
          if (!existsSync(图)) return { ok: false, messageId: 0, reason: `找不到这张图：${图}` };
          消息.push({ type: 'image', data: { file: 图.startsWith('file://') ? 图 : `file:///${图.replace(/\\/g, '/')}` } });
        }

        const 等待 = c.minDelayMs + Math.random() * Math.max(0, c.maxDelayMs - c.minDelayMs);
        await 睡眠(等待);

        try {
          const r = await 调(是群 ? 'send_group_msg' : 'send_private_msg', {
            [是群 ? 'group_id' : 'user_id']: 号,
            message: 消息,
          });
          记账(账本, 号, 正文 || `[图片]${图}`);
          return { ok: true, messageId: Number(r.data?.message_id ?? 0) };
        } catch (e) {
          return { ok: false, messageId: 0, reason: e.message };
        }
      },
    }),
  );

  // ---------- qq_read ----------
  ctx.effect(() =>
    ctx.tools.register({
      name: 'qq_read',
      description:
        '读 QQ 小号最近收到的消息。插件自己挂着 WebSocket 收，不用外部脚本。count 默认 20，最多 100。',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '要几条，默认 20' },
        },
        additionalProperties: false,
      },
      output: 工具输出({ lines: { type: 'array', items: { type: 'string' } } }, (v) => {
        if (!v.ok) return `读不到：${v.reason ?? '未知原因'}`;
        if (!v.lines || v.lines.length === 0) return '收件箱是空的。';
        return v.lines.join('\n');
      }),
      async execute(args) {
        const 数量 = Math.min(Math.max(Number(args?.count ?? 20), 1), 100);
        try {
          // 内存缓冲最新鲜；文件兜底（重启后还在）
          const 来源 = 收件缓冲.length > 0
            ? 收件缓冲.slice(-数量)
            : (existsSync(收件箱)
                ? readFileSync(收件箱, 'utf8').trim().split('\n').filter(Boolean).slice(-数量)
                    .map((s) => {
                      try { return JSON.parse(s); } catch { return null; }
                    })
                    .filter(Boolean)
                : []);
          const 行 = 来源.map((m) => {
            const 谁 = m.kind === 'group' ? `${m.name}（群 ${m.group}）` : m.name;
            return `${m.t}｜${谁}：${m.text}`;
          });
          return { ok: true, lines: 行 };
        } catch (e) {
          return { ok: false, lines: [], reason: e.message };
        }
      },
    }),
  );

  // ---------- qq_stickers ----------
  ctx.effect(() =>
    ctx.tools.register({
      name: 'qq_stickers',
      description:
        '列出手里攒着的图（别人发来的表情包都自动存在本地）。拿到路径就能用 qq_send 的 image 发出去。',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '要几张，默认 10' },
        },
        additionalProperties: false,
      },
      output: 工具输出({ lines: { type: 'array', items: { type: 'string' } } }, (v) => {
        if (!v.ok) return `列不出来：${v.reason ?? '未知原因'}`;
        if (!v.lines || v.lines.length === 0) return '手里还没有图。';
        return v.lines.join('\n');
      }),
      async execute(args) {
        const 数量 = Math.min(Math.max(Number(args?.count ?? 10), 1), 50);
        try {
          const 目录 = join(家目录(), 'media');
          if (!existsSync(目录)) return { ok: true, lines: [] };
          const 文件 = readdirSync(目录)
            .filter((n) => /\.(jpg|jpeg|png|gif|webp)$/i.test(n))
            .map((n) => {
              const 全 = join(目录, n);
              return { 路径: 全, 时间: statSync(全).mtimeMs };
            })
            .sort((a, b) => b.时间 - a.时间)
            .slice(0, 数量)
            .map((x) => `${new Date(x.时间).toISOString().slice(0, 16)}｜${x.路径}`);
          return { ok: true, lines: 文件 };
        } catch (e) {
          return { ok: false, lines: [], reason: e.message };
        }
      },
    }),
  );

  // ---------- qq_qzone ----------
  ctx.effect(() =>
    ctx.tools.register({
      name: 'qq_qzone',
      description:
        '用 QQ 小号发一条 QQ 空间说说。只发轻的东西，不点名、不写具体地点，别当朋友圈刷。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '说说正文，两三句就够' },
        },
        required: ['content'],
        additionalProperties: false,
      },
      output: 工具输出({ tid: { type: 'string' } }, (v) =>
        v.ok ? `说说发出去了（tid ${v.tid}）。` : `没发成：${v.reason ?? '未知原因'}`,
      ),
      async execute(args) {
        const 正文 = String(args?.content ?? '').trim();
        if (!正文) return { ok: false, tid: '', reason: '正文是空的' };
        try {
          const r = await 调('send_qzone_msg', { content: 正文 });
          记账(账本, 'qzone', 正文);
          return { ok: true, tid: String(r.data?.tid ?? '') };
        } catch (e) {
          return { ok: false, tid: '', reason: e.message };
        }
      },
    }),
  );
}
