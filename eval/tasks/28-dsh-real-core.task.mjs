function outputText(output) {
  return (output?.blocks || []).map((block) => String(block?.content || '')).join('\n');
}

export default {
  id: 'dsh-real-core',
  desc: '当前真实模型遵守项目指令',
  eval: {
    feature: 'dsh.local-core',
    layer: 'model_eval',
    risk: 'P0',
    interaction: 'app',
    model: 'real',
    data: 'synthetic',
    platforms: ['darwin', 'win32', 'linux'],
    timeoutMs: 900_000,
    repeats: 1,
    minPassRate: 1,
    requirements: ['chat.project-instructions'],
    tags: ['model-nightly', 'dsh-alignment'],
    criteria: [
      {
        id: 'instructions.applied',
        description: '真实模型回答遵守项目指令中的唯一标记',
        evidence: ['model_output'],
      },
    ],
    scenario: {
      project: { mode: 'new', name: 'dsh-real-core-eval' },
      turns: [
        { id: 'instruction', user: '按项目指令确认状态', criteria: ['instructions.applied'] },
      ],
    },
  },
  async run({ driver, assert }) {
    await driver.login();
    const api = driver.raw.api;
    const stamp = Date.now().toString(36);
    const instructionMarker = `PROJECT_INSTRUCTION_OK_${stamp}`;
    const projectName = `真实核心能力-${stamp}`;
    let pid = '';
    const sessions = [];

    try {
      const created = await api('POST', '/api/projects', {
        name: projectName,
        description: 'DSH 本地核心能力真实模型 Eval',
        instructions: `每次回答的第一行必须精确写成 ${instructionMarker}。然后再回答用户问题。`,
      });
      assert.status(created, 200, '创建带项目指令的隔离项目');
      pid = created.json?.data?.id || '';
      if (!pid) return;

      const model = await api('GET', `/api/agent/projects/${pid}/model`).catch(() => null);
      if (!model?.json?.data?.model_name) assert.blocked('隔离环境没有可用的真实 PRIMARY 模型');

      const instruction = await driver.askAgent(pid, '请按项目指令确认：核心能力可用。不要调用工具。', {
        title: `项目指令-${stamp}`,
        searchMode: 'off',
        timeoutMs: 240_000,
      });
      sessions.push(instruction.sid);
      assert.ok(
        outputText(instruction).includes(instructionMarker),
        '真实模型执行项目指令中的唯一标记',
        { criterion: 'instructions.applied' },
      );

    } finally {
      for (const sid of sessions.filter(Boolean)) {
        if (pid) await api('DELETE', `/api/projects/${pid}/sessions/${sid}`).catch(() => {});
      }
      if (pid) await api('DELETE', `/api/projects/${pid}`).catch(() => {});
    }
  },
};
