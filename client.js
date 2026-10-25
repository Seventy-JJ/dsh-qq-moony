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

      React.useEffect(() => {
        if (状态 && 草稿 === null) {
          设草稿({
            everyMinMin: 状态.everyMinMin ?? 45,
            everyMinMax: 状态.everyMinMax ?? 90,
            perHour: 状态.perHour ?? 20,
            perDay: 状态.perDay ?? 60,
            qzoneMinMin: 状态.qzoneMinMin ?? 120,
            qzoneMinMax: 状态.qzoneMinMax ?? 240,
            qzonePrompt: 状态.qzonePrompt ?? '',
            groupWhitelist: (状态.groupWhitelist ?? []).join(' '),
            groupContextSize: 状态.groupContextSize ?? 30,
            groupEveryMinMin: 状态.groupEveryMinMin ?? 8,
            groupEveryMinMax: 状态.groupEveryMinMax ?? 20,
            groupActiveWindowMin: 状态.groupActiveWindowMin ?? 5,
            groupCooldownMin: 状态.groupCooldownMin ?? 10,
            groupPerDay: 状态.groupPerDay ?? 20,
          });
        }
      }, [状态, 草稿]);

      const 数字 = (键, 值) => {
        设草稿((旧) => ({ ...(旧 ?? {}), [键]: 值 }));
        设脏(true);
      };

      const 保存 = async () => {
        if (!草稿) return;
        await 改({
          everyMinMin: Number(草稿.everyMinMin),
          everyMinMax: Number(草稿.everyMinMax),
          perHour: Number(草稿.perHour),
          perDay: Number(草稿.perDay),
          qzoneMinMin: Number(草稿.qzoneMinMin),
          qzoneMinMax: Number(草稿.qzoneMinMax),
          qzonePrompt: String(草稿.qzonePrompt ?? ''),
          groupWhitelist: String(草稿.groupWhitelist ?? ''),
          groupContextSize: Number(草稿.groupContextSize),
          groupEveryMinMin: Number(草稿.groupEveryMinMin),
          groupEveryMinMax: Number(草稿.groupEveryMinMax),
          groupActiveWindowMin: Number(草稿.groupActiveWindowMin),
          groupCooldownMin: Number(草稿.groupCooldownMin),
          groupPerDay: Number(草稿.groupPerDay),
        });
        设脏(false);
        设草稿(null);
      };

      if (状态 === null || 草稿 === null) {
        return h('div', { style: { padding: '8px 0', opacity: 0.6 } }, 错 || '读状态中…');
      }

      return h(
        'div',
        null,
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
          { style: { ...卡片 } },
          h(
            'div',
            null,
            h('div', { style: 标题 }, '主动说话'),
            h('div', { style: 说明 }, `开着它才会自己找你，大约每 ${草稿.everyMinMin}–${草稿.everyMinMax} 分钟有机会开口一次；关掉就只回不发`),
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
              value: 草稿.everyMinMin,
              onChange: (e) => 数字('everyMinMin', Number(e.target.value)),
              style: { ...输入框, width: '78px' },
            }),
            h('span', { style: { opacity: 0.5 } }, '—'),
            h('input', {
              type: 'number',
              min: 5,
              value: 草稿.everyMinMax,
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
            value: 草稿.perHour,
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
            value: 草稿.perDay,
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
            value: 草稿.groupWhitelist,
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
              value: 草稿.groupContextSize,
              onChange: (e) => 数字('groupContextSize', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: 说明 }, '条 · 每'),
            h('input', {
              type: 'number',
              min: 2,
              value: 草稿.groupEveryMinMin,
              onChange: (e) => 数字('groupEveryMinMin', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: { opacity: 0.5 } }, '—'),
            h('input', {
              type: 'number',
              min: 2,
              value: 草稿.groupEveryMinMax,
              onChange: (e) => 数字('groupEveryMinMax', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: 说明 }, '分钟给一次机会 · 冷场'),
            h('input', {
              type: 'number',
              min: 1,
              value: 草稿.groupActiveWindowMin,
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
              value: 草稿.groupCooldownMin,
              onChange: (e) => 数字('groupCooldownMin', Number(e.target.value)),
              style: { ...输入框, width: '70px' },
            }),
            h('span', { style: 说明 }, '分钟 · 群里一天最多'),
            h('input', {
              type: 'number',
              min: 1,
              value: 草稿.groupPerDay,
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
              value: 草稿.qzonePrompt,
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
                value: 草稿.qzoneMinMin,
                onChange: (e) => 数字('qzoneMinMin', Number(e.target.value)),
                style: { ...输入框, width: '78px' },
              }),
              h('span', { style: { opacity: 0.5 } }, '—'),
              h('input', {
                type: 'number',
                min: 10,
                value: 草稿.qzoneMinMax,
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
