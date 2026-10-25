window.__ModuleLoader__.load({
  id: 'dsh-qq-moony',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const 卡片 = {
      border: '1px solid var(--dsw-alias-border-2, rgba(127,127,127,0.25))',
      borderRadius: '12px',
      padding: '14px 16px',
      marginBottom: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
    };
    const 标题 = { fontSize: '14px', fontWeight: 600, marginBottom: '4px' };
    const 说明 = { fontSize: '12px', opacity: 0.65, lineHeight: '18px' };
    const 输入框 = {
      width: '90px',
      padding: '6px 8px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-2, rgba(127,127,127,0.35))',
      background: 'transparent',
      color: 'inherit',
    };

    function 开关({ 开, 点 }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': Boolean(开),
          onClick: 点,
          style: {
            width: '44px',
            height: '24px',
            borderRadius: '999px',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
            background: 开
              ? 'var(--dsw-alias-accent-1, #4d8dff)'
              : 'var(--dsw-alias-bg-3, rgba(127,127,127,0.35))',
            position: 'relative',
            transition: 'background 120ms',
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: '3px',
            left: 开 ? '23px' : '3px',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 120ms',
          },
        }),
      );
    }

    function 面板() {
      const [状态, 设置状态] = React.useState(null);
      const [错, 设置错] = React.useState('');

      const 刷新 = React.useCallback(() => {
        fetch('/api/qq-moony/state')
          .then((r) => r.json())
          .then((s) => 设置状态(s))
          .catch((e) => 设置错(String(e)));
      }, []);

      React.useEffect(() => {
        刷新();
        const 定时 = setInterval(刷新, 15000);
        return () => clearInterval(定时);
      }, [刷新]);

      const 改 = async (patch) => {
        设置状态((旧) => ({ ...(旧 ?? {}), ...patch }));
        try {
          const r = await fetch('/api/qq-moony/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
          const s = await r.json();
          if (!s.ok) 设置错(s.error || '保存失败');
          刷新();
        } catch (e) {
          设置错(String(e));
          刷新();
        }
      };

      // 数字项走草稿：不立刻提交，等"保存更改"
      const [草稿, 设草稿] = React.useState(null);
      const [脏, 设脏] = React.useState(false);

      // 草稿没建起来之前，先用状态里的值兜底——省得"保存"之后闪回空白
      const 从状态取 = () => ({
        everyMinMin: 状态?.everyMinMin ?? 45,
        everyMinMax: 状态?.everyMinMax ?? 90,
        perHour: 状态?.perHour ?? 20,
        perDay: 状态?.perDay ?? 60,
        qzoneMinMin: 状态?.qzoneMinMin ?? 120,
        qzoneMinMax: 状态?.qzoneMinMax ?? 240,
        qzonePrompt: 状态?.qzonePrompt ?? '',
        persona: 状态?.persona ?? '',
        groupWhitelist: (状态?.groupWhitelist ?? []).join(' '),
        groupContextSize: 状态?.groupContextSize ?? 30,
        groupEveryMinMin: 状态?.groupEveryMinMin ?? 8,
        groupEveryMinMax: 状态?.groupEveryMinMax ?? 20,
        groupActiveWindowMin: 状态?.groupActiveWindowMin ?? 5,
        groupCooldownMin: 状态?.groupCooldownMin ?? 10,
        groupPerDay: 状态?.groupPerDay ?? 20,
      });

      React.useEffect(() => {
        if (状态 && 草稿 === null) {
          设草稿(从状态取());
        }
      }, [状态, 草稿]);

      const 数字 = (键, 新值) => {
        设草稿((旧) => ({ ...(旧 ?? 从状态取()), [键]: 新值 }));
        设脏(true);
      };

      const 保存 = async () => {
        const 值 = 草稿 ?? 从状态取();
        await 改({
          everyMinMin: Number(值.everyMinMin),
          everyMinMax: Number(值.everyMinMax),
          perHour: Number(值.perHour),
          perDay: Number(值.perDay),
          qzoneMinMin: Number(值.qzoneMinMin),
          qzoneMinMax: Number(值.qzoneMinMax),
          qzonePrompt: String(值.qzonePrompt ?? ''),
          persona: String(值.persona ?? ''),
          groupWhitelist: String(值.groupWhitelist ?? ''),
          groupContextSize: Number(值.groupContextSize),
          groupEveryMinMin: Number(值.groupEveryMinMin),
          groupEveryMinMax: Number(值.groupEveryMinMax),
          groupActiveWindowMin: Number(值.groupActiveWindowMin),
          groupCooldownMin: Number(值.groupCooldownMin),
          groupPerDay: Number(值.groupPerDay),
        });
        设脏(false);
        设草稿(null);
      };

      if (状态 === null) {
        return h('div', { style: { padding: '8px 0', opacity: 0.6 } }, 错 || '读状态中…');
      }

      const 值 = 草稿 ?? 从状态取();
      const 缺口 = [];
      if (!状态.qqnt) 缺口.push('没找到 QQ NT —— 去 im.qq.com 装新版（9.9.x）。老版 9.7 注不进去，这是死条件。');
      if (!状态.napcat) 缺口.push('没找到 NapCat —— 去 github.com/NapNeko/NapCatQQ 下 Shell 版，解压后把 napCatDir 指过去。');
      if (状态.portState === 'foreign')
        缺口.push('端口上坐着的不是 NapCat —— 3000 被别的服务占了。换个端口（改 baseUrl），或者把那个服务挪开。');
      else if (状态.qqnt && 状态.napcat && !状态.online)
        缺口.push('QQ NT 和 NapCat 都在，但连不上 —— 检查 NapCat 启没启、3000 端口、token 三样。');

      return h(
        'div',
        null,
        缺口.length > 0
          ? h(
              'div',
              {
                style: {
                  ...卡片,
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: '6px',
                  borderColor: 'var(--dsw-alias-warning-1, #d99b2b)',
                },
              },
              h(
                'div',
                { style: { ...标题, color: 'var(--dsw-alias-warning-1, #d99b2b)' } },
                '还差几步才能用',
              ),
              缺口.map((行, i) => h('div', { key: i, style: 说明 }, `${i + 1}. ${行}`)),
            )
          : null,
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, 状态.online ? `已连接：${状态.nickname}` : '没连上 NapCat'),
            h(
              'div',
              { style: 说明 },
              状态.online
                ? `今天发了 ${状态.sentToday} 条，这一小时 ${状态.sentThisHour} 条（上限 ${状态.perDay}/天、${状态.perHour}/时）`
                : '检查 NapCat 有没有启动、3000 端口通不通、token 对不对',
            ),
          ),
        ),
        h(
          'div',
          { style: { ...卡片, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: 1 } },
            h('div', { style: 标题 }, '人设（可选）'),
            h(
              'div',
              { style: 说明 },
              '填了就把这段当作「你是谁」交给自动回复的会话；留空则用中性的“替账号主人收发消息”。不想让这个号变成别人的角色，就别填。',
            ),
            h('textarea', {
              rows: 3,
              value: 值.persona,
              placeholder: '例：你是这个账号主人在 DSH 里养的助手，说话短、口语，不自我介绍',
              onChange: (e) => 数字('persona', e.target.value),
              style: {
                width: '100%',
                marginTop: '8px',
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid var(--dsw-alias-border-2, rgba(127,127,127,0.35))',
                background: 'transparent',
                color: 'inherit',
                fontSize: '12px',
                lineHeight: '19px',
                resize: 'vertical',
                boxSizing: 'border-box',
              },
            }),
          ),
        ),
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '主动说话'),
            h('div', { style: 说明 }, `开着它才会自己找你，大约每 ${值.everyMinMin}–${值.everyMinMax} 分钟有机会开口一次；关掉就只回不发`),
          ),
          h(开关, { 开: 状态.proactive, 点: () => 改({ proactive: !状态.proactive }) }),
        ),
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '自动回复'),
            h('div', { style: 说明 }, '收到私聊就投进专用会话去回；群消息一律不接'),
          ),
          h(开关, { 开: 状态.autoReply, 点: () => 改({ autoReply: !状态.autoReply }) }),
        ),
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '主动间隔'),
            h('div', { style: 说明 }, '每次从这段区间里随机取一个（分钟）：最短 / 最长'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('input', {
              type: 'number',
              min: 5,
              value: 值.everyMinMin,
              onChange: (e) => 数字('everyMinMin', Number(e.target.value)),
              style: { ...输入框, width: '78px' },
            }),
            h('span', { style: { opacity: 0.5 } }, '—'),
            h('input', {
              type: 'number',
              min: 5,
              value: 值.everyMinMax,
              onChange: (e) => 数字('everyMinMax', Number(e.target.value)),
              style: { ...输入框, width: '78px' },
            }),
          ),
        ),
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '每小时上限'),
            h('div', { style: 说明 }, '一小时内最多发几条（1–200），到顶直接拒发'),
          ),
          h('input', {
            type: 'number',
            min: 1,
            max: 200,
            value: 值.perHour,
            onChange: (e) => 数字('perHour', Number(e.target.value)),
            style: 输入框,
          }),
        ),
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '每天上限'),
            h('div', { style: 说明 }, '一天内最多发几条（1–1000），按自然日算'),
          ),
          h('input', {
            type: 'number',
            min: 1,
            max: 1000,
            value: 值.perDay,
            onChange: (e) => 数字('perDay', Number(e.target.value)),
            style: 输入框,
          }),
        ),
        h(
          'div',
          { style: { ...卡片, alignItems: 'flex-start', flexDirection: 'column', gap: '10px' } },
          h(
            'div',
            { style: { display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '16px' } },
            h(
              'div',
              null,
              h('div', { style: 标题 }, '群聊'),
              h('div', { style: 说明 }, '白名单里的群才理；只接被 @ 的，或者按下面的节奏自己插一句'),
            ),
            h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
              h('span', { style: 说明 }, '接消息'),
              h(开关, { 开: 状态.groupReply, 点: () => 改({ groupReply: !状态.groupReply }) }),
              h('span', { style: 说明 }, '参与聊天'),
              h(开关, { 开: 状态.groupChat, 点: () => 改({ groupChat: !状态.groupChat }) }),
            ),
          ),
          h('input', {
            type: 'text',
            value: 值.groupWhitelist,
            placeholder: '群号白名单，空格或逗号分隔；空着 = 群聊不生效',
            onChange: (e) => 数字('groupWhitelist', e.target.value),
            style: { ...输入框, width: '100%', boxSizing: 'border-box' },
          }),
          h(
            'div',
            { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
            h('span', { style: 说明 }, '记住最近'),
            h('input', {
              type: 'number',
              min: 5,
              max: 100,
              value: 值.groupContextSize,
              onChange: (e) => 数字('groupContextSize', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: 说明 }, '条 · 每'),
            h('input', {
              type: 'number',
              min: 2,
              value: 值.groupEveryMinMin,
              onChange: (e) => 数字('groupEveryMinMin', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: { opacity: 0.5 } }, '—'),
            h('input', {
              type: 'number',
              min: 2,
              value: 值.groupEveryMinMax,
              onChange: (e) => 数字('groupEveryMinMax', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: 说明 }, '分钟给一次机会 · 冷场'),
            h('input', {
              type: 'number',
              min: 1,
              value: 值.groupActiveWindowMin,
              onChange: (e) => 数字('groupActiveWindowMin', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: 说明 }, '分钟内没人才开口'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
            h('span', { style: 说明 }, '同群冷却'),
            h('input', {
              type: 'number',
              min: 1,
              value: 值.groupCooldownMin,
              onChange: (e) => 数字('groupCooldownMin', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: 说明 }, '分钟 · 群里一天最多'),
            h('input', {
              type: 'number',
              min: 1,
              value: 值.groupPerDay,
              onChange: (e) => 数字('groupPerDay', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: 说明 }, '条'),
          ),
          h(
            'div',
            { style: { ...说明, color: 'var(--dsw-alias-warning-1, #d99b2b)' } },
            '⚠️ 参与聊天很费 token：每给一次机会都等于跑一整轮会话，哪怕它最后决定不说话。间隔别设太短。',
          ),
        ),
        h(
          'div',
          { style: { ...卡片, alignItems: 'flex-start' } },
          h(
            'div',
            { style: { flex: 1 } },
            h('div', { style: 标题 }, 'QQ 空间自动发说说'),
            h(
              'div',
              { style: 说明 },
              '开着才会自己去空间发；下面写要求（内容、时间、语气都行），到点把这句交给它判断',
            ),
            h('textarea', {
              rows: 3,
              value: 值.qzonePrompt,
              placeholder: '例：一周发一次，写点最近的感受，两三句，不要提具体的人和地点',
              onChange: (e) => 数字('qzonePrompt', e.target.value),
              style: {
                width: '100%',
                marginTop: '8px',
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid var(--dsw-alias-border-2, rgba(127,127,127,0.35))',
                background: 'transparent',
                color: 'inherit',
                fontSize: '12px',
                lineHeight: '19px',
                resize: 'vertical',
                boxSizing: 'border-box',
              },
            }),
            h(
              'div',
              { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } },
              h('span', { style: 说明 }, '每隔'),
              h('input', {
                type: 'number',
                min: 10,
                value: 值.qzoneMinMin,
                onChange: (e) => 数字('qzoneMinMin', Number(e.target.value)),
                style: { ...输入框, width: '78px' },
              }),
              h('span', { style: { opacity: 0.5 } }, '—'),
              h('input', {
                type: 'number',
                min: 10,
                value: 值.qzoneMinMax,
                onChange: (e) => 数字('qzoneMinMax', Number(e.target.value)),
                style: { ...输入框, width: '78px' },
              }),
              h('span', { style: 说明 }, '分钟随机一次'),
            ),
          ),
          h(开关, { 开: 状态.qzoneAuto, 点: () => 改({ qzoneAuto: !状态.qzoneAuto }) }),
        ),
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '不限条数'),
            h('div', { style: 说明 }, '关掉每小时/每天的上限。⚠️ 只在确实需要时开——额度是防封的第一道闸'),
          ),
          h(开关, { 开: 状态.limitsUnlimited, 点: () => 改({ limitsUnlimited: !状态.limitsUnlimited }) }),
        ),
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '配表情包'),
            h('div', { style: 说明 }, '回话时如果合适，自己从库里挑一张一起发'),
          ),
          h(开关, { 开: 状态.stickerOnReply, 点: () => 改({ stickerOnReply: !状态.stickerOnReply }) }),
        ),
        h(
          'div',
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '自动收录表情包'),
            h('div', { style: 说明 }, '收到图会看一眼，值得收才收（重复、糊的、真人照片不收）'),
          ),
          h(开关, { 开: 状态.autoTagStickers, 点: () => 改({ autoTagStickers: !状态.autoTagStickers }) }),
        ),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center' } },
          脏 ? h('span', { style: { ...说明, opacity: 0.7 } }, '还没保存') : null,
          h(
            'button',
            {
              type: 'button',
              onClick: 保存,
              disabled: !脏,
              style: {
                padding: '8px 18px',
                borderRadius: '10px',
                border: 'none',
                cursor: 脏 ? 'pointer' : 'default',
                fontSize: '13px',
                fontWeight: 600,
                color: '#fff',
                background: 脏 ? 'var(--dsw-alias-accent-1, #4d8dff)' : 'var(--dsw-alias-bg-3, rgba(127,127,127,0.35))',
              },
            },
            '保存更改',
          ),
        ),
        错
          ? h('div', { style: { ...说明, color: 'var(--dsw-alias-danger-1, #ff5d5d)' } }, 错)
          : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'qq-moony', order: 32, label: 'QQ嗦嗨嗨' },
            面板,
          ),
        );
      },
    };
  },
});
