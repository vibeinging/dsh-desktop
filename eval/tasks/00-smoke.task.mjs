// Smoke test: verifies app is operable in real UI. Fast and does not call LLM.
export default {
  id: 'smoke',
  desc: 'UI 冒烟',
  eval: {
    feature: 'app.shell',
    layer: 'ui_e2e',
    risk: 'P0',
    interaction: 'cdp',
    model: 'none',
    data: 'synthetic',
    platforms: ['darwin', 'win32'],
    timeoutMs: 60_000,
    repeats: 1,
    minPassRate: 1,
    requirements: ['app.shell.ready', 'app.legacy-route-removed'],
    tags: ['pr', 'ui'],
    criteria: [
      {
        id: 'project.available',
        description: '隔离环境可以创建或选择项目',
        evidence: ['api'],
      },
      {
        id: 'shell.input-ready',
        description: '真实 Renderer 显示主窗口输入框',
        evidence: ['ui'],
      },
      {
        id: 'shell.input-interactive',
        description: '真实鼠标和键盘可以编辑消息输入框',
        evidence: ['ui', 'cdp'],
      },
      {
        id: 'shell.legacy-hidden',
        description: '旧入口不再挂载旧页面',
        evidence: ['ui'],
      },
    ],
  },
  async run({ driver, assert }) {
    const created = await driver.raw.officialRpc('workspace.create', { path: process.cwd() });
    const workspaceId = created?.workspace?.workspaceId || created?.workspaceId;
    assert.ok(!!workspaceId, '可创建或选择项目', { criterion: 'project.available' });

    const composer = '[data-composer-input][contenteditable="true"]';
    await driver.ui.goto('/');
    await driver.raw.dismissOfficialModelPrompt();
    await driver.ui.click('button[aria-label="新建会话"],button[aria-label="New session"]', { timeout: 15000 });
    await driver.ui.waitFor(composer, { timeout: 15000 });
    assert.ok(
      await driver.ui.exists(composer),
      'app 主界面输入框可用',
      { criterion: 'shell.input-ready' },
    );
    const marker = `EVAL_INPUT_${Date.now().toString(36)}`;
    await driver.ui.click(composer);
    await driver.raw.ev(`document.querySelector(${JSON.stringify(composer)})?.focus(); return true;`);
    await driver.ui.typeText(marker);
    const typed = await driver.ui.waitUntil(
      `() => document.querySelector(${JSON.stringify(composer)})?.textContent?.includes(${JSON.stringify(marker)})`,
      { timeout: 5000, label: '消息输入框接收真实键盘输入' },
    );
    assert.ok(typed, '真实鼠标和键盘可以填写消息', { criterion: 'shell.input-interactive' });
    await driver.raw.ev(`document.querySelector(${JSON.stringify(composer)})?.focus(); return true;`);
    await driver.ui.press(process.platform === 'darwin' ? 'Meta+A' : 'Ctrl+A');
    await driver.ui.press('Backspace');
    assert.eq(
      await driver.ui.exists('#Sidebar'),
      false,
      'app 主界面不挂载旧侧边栏',
      { criterion: 'shell.legacy-hidden' },
    );

    for (const path of ['/projects', '/database', `/project/${workspaceId}/settings`, '/dashboard']) {
      await driver.ui.goto(path);
      assert.eq(await driver.ui.exists('#Sidebar'), false, `${path} 不应显示旧侧边栏`, { criterion: 'shell.legacy-hidden' });
      assert.eq(await driver.ui.exists('[data-testid="database-page"]'), false, `${path} 不应显示旧数据库页`, { criterion: 'shell.legacy-hidden' });
      assert.eq(await driver.ui.exists('[data-testid="project-page"]'), false, `${path} 不应显示旧项目页`, { criterion: 'shell.legacy-hidden' });
    }
    await driver.ui.goto('/');
    await driver.ui.waitFor(composer, { timeout: 15000 });
    assert.ok(await driver.ui.exists(composer), '旧入口检查后可返回 app 主界面', { criterion: 'shell.input-ready' });
  },
};
