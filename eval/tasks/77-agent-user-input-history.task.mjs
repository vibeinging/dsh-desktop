function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default {
  id: 'agent-user-input-history',
  desc: '真实模型 request_user_input 的回答在流、历史和 Electron 重载 UI 中保持一致',
  eval: {
    feature: 'agent.user-input.history-ui',
    layer: 'model_eval',
    risk: 'P0',
    interaction: 'app',
    model: 'real',
    data: 'synthetic',
    platforms: ['darwin', 'win32', 'linux'],
    timeoutMs: 360_000,
    repeats: 1,
    minPassRate: 1,
    requirements: ['agent.native-tool.request-user-input', 'agent.history', 'agent.ui'],
    tags: ['model-nightly', 'dsh-alignment'],
    criteria: [
      {
        id: 'user-input.real-lifecycle',
        description: '真实模型调用 request_user_input 并在同一 Turn 内收到回答',
        evidence: ['stream_events', 'model_output'],
      },
      {
        id: 'user-input.history',
        description: '结构化回答持久化后仍可正确解释，且不会显示对象字符串',
        evidence: ['api', 'renderer_output'],
      },
      {
        id: 'user-input.ui-reload',
        description: 'Electron 重载历史后展示已选择值且不能重复提交',
        evidence: ['ui', 'cdp'],
      },
    ],
    scenario: {
      project: { mode: 'new', name: 'agent-user-input-history-eval' },
      turns: [{
        id: 'request-user-input',
        user: '先询问配置选择，再按回答继续',
        criteria: ['user-input.real-lifecycle', 'user-input.history', 'user-input.ui-reload'],
      }],
    },
  },
  async run({ driver, assert }) {
    await driver.login();
    const api = driver.raw.api;
    const stamp = Date.now().toString(36);
    const projectName = `request_user_input-${stamp}`;
    let pid = '';
    let sid = '';
    try {
      const created = await api('POST', '/api/projects', {
        name: projectName,
        description: 'request_user_input 真实历史重载 Eval',
      });
      assert.status(created, 200, '创建隔离项目');
      pid = created.json?.data?.id || '';
      if (!pid) return;

      const model = await api('GET', `/api/agent/projects/${pid}/model`).catch(() => null);
      if (!model?.json?.data?.model_name) assert.blocked('隔离环境没有可用的真实 PRIMARY 模型');

      const output = await driver.askAgent(
        pid,
        [
          '请为当前项目制定运行配置方案。方案方向取决于用户选择，禁止自行决定；回答任何内容之前，必须真实调用 request_user_input 一次，不能在普通文字里假装询问。',
          '只提一个问题：header 为“配置”，question 为“请选择运行配置”，选项按顺序为“使用推荐配置”和“使用精简配置”，第一项标为推荐。',
          '收到用户选择后，把选择写进方案，并严格使用唯一一组 <proposed_plan> 和 </proposed_plan> 标签输出方案；不要修改任何文件。',
        ].join('\n'),
        {
          title: `request_user_input-${stamp}`,
          collaborationMode: 'plan',
          autoResolveUserInput: true,
          searchMode: 'off',
          timeoutMs: 240_000,
        },
      );
      sid = output.sid;
      assert.ok((output.autoResolvedUserInputIds || []).length >= 1, '驱动真实回答 request_user_input', {
        criterion: 'user-input.real-lifecycle',
      });
      assert.eq(output.userInputErrors?.length || 0, 0, '回答 request_user_input 没有请求错误', {
        criterion: 'user-input.real-lifecycle',
      });
      assert.ok((output.events || []).some((event) => (
        String(event.type || '').endsWith('item/started') && event.item_type === 'userInput'
      )), '收到原生 userInput started 事件', { criterion: 'user-input.real-lifecycle' });
      assert.ok((output.events || []).some((event) => (
        String(event.type || '').endsWith('item/completed')
          && event.item_type === 'userInput'
          && ['answered', 'resolved'].includes(String(event.status || ''))
      )), '收到原生 userInput answered 事件', { criterion: 'user-input.real-lifecycle' });

      const history = await api('GET', `/api/projects/${pid}/sessions/${sid}/messages`);
      assert.status(history, 200, '读取回答后的真实历史');
      const messages = history.json?.data?.messages || [];
      const userInputs = messages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => parseArray(message.content_items))
        .filter((item) => item.type === 'user_input');
      const requestedConfigurationInputs = userInputs.filter((item) => (
        parseObject(item.content).questions?.some((question) => question.question === '请选择运行配置')
      ));
      assert.eq(requestedConfigurationInputs.length, 1, '历史只保存一次运行配置 user_input', {
        criterion: 'user-input.history',
      });
      const [userInput] = requestedConfigurationInputs;
      assert.eq(userInput?.title, 'resolved', 'user_input 最终状态写入历史', {
        criterion: 'user-input.history',
      });
      if (!userInput) return;
      const persisted = parseObject(userInput?.content);
      const persistedAnswers = persisted.answers?.[persisted.questions?.[0]?.id]?.answers || [];
      assert.ok(
        persistedAnswers.length === 1 && String(persistedAnswers[0]).startsWith('使用推荐配置'),
        '历史保存结构化推荐选项',
        { criterion: 'user-input.history' },
      );
      assert.ok(!String(JSON.stringify(userInput) || '').includes('[object Object]'), '历史没有对象字符串污染', {
        criterion: 'user-input.history',
      });

      const sessionDetail = await api('GET', `/api/projects/${pid}/sessions/${sid}`);
      assert.status(sessionDetail, 200, '读取 App 与 DSH 会话绑定');
      const sessionConfig = parseObject(sessionDetail.json?.data?.session_config);
      const runtimeSessionId = String(sessionConfig.dsh_runtime_session_id || '');
      assert.ok(Boolean(runtimeSessionId), 'App 会话保存 DSH runtime session id', {
        criterion: 'user-input.ui-reload',
      });

      await driver.ui.goto('/');
      await driver.raw.dismissOfficialModelPrompt();
      const nativeSessions = await driver.raw.officialRpc('session.list');
      const nativeSession = (nativeSessions.items || []).find((item) => item.sessionId === runtimeSessionId);
      assert.ok(Boolean(nativeSession), '官方 Web 重载后列出对应 DSH 会话', {
        criterion: 'user-input.ui-reload',
      });
      if (!nativeSession) return;
      const nativeTitle = String(nativeSession.projections?.values?.title || projectName);
      await driver.ui.clickText(nativeTitle, {
        selector: '[role="treeitem"]',
        timeout: 20_000,
      });
      const answeredSelector = '[data-tool="ask_user_question"][data-state="ok"]';
      await driver.ui.waitFor(answeredSelector, { timeout: 20_000 });
      await driver.ui.click(`${answeredSelector} [data-disclosure-row]`, { timeout: 10_000 });
      await driver.raw.ev('await new Promise((resolve) => setTimeout(resolve, 250)); return true;');
      const rendered = await driver.raw.ev(`
        const card = document.querySelector(${JSON.stringify(answeredSelector)});
        return {
          text: String(card?.textContent || '').replace(/\\s+/g, ' ').trim(),
          submit: [...(card?.querySelectorAll('button') || [])].some((button) => ['提交', 'Submit', 'submit'].includes(String(button.textContent || '').trim())),
          pendingQuestion: Boolean(document.querySelector('[data-question-key]')),
        };
      `);
      assert.ok(rendered.text.includes('使用推荐配置'), '历史重载 UI 展示真实选择值', {
        criterion: 'user-input.ui-reload',
      });
      assert.ok(!rendered.text.includes('[object Object]'), '历史重载 UI 不显示对象字符串', {
        criterion: 'user-input.ui-reload',
      });
      assert.eq(rendered.submit, false, '已回答历史不再显示提交按钮', {
        criterion: 'user-input.ui-reload',
      });
      assert.eq(rendered.pendingQuestion, false, '已回答历史不会恢复成待回答问题', {
        criterion: 'user-input.ui-reload',
      });
    } finally {
      if (pid && sid) await api('DELETE', `/api/projects/${pid}/sessions/${sid}`).catch(() => {});
      if (pid) await api('DELETE', `/api/projects/${pid}`).catch(() => {});
    }
  },
};
