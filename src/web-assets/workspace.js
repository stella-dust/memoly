'use strict';

const main = document.querySelector('main');
const nav = document.querySelector('#nav');
const notice = document.querySelector('#notice');
const ownerFragment = new URLSearchParams(location.hash.slice(1)).get('owner');
let owner = ownerFragment || '';
let tab = 'vault';
let selectedNote;
let renderCount = 0;
let noticeTimeout;

if (ownerFragment !== null) history.replaceState(null, '', location.pathname);

function element(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children.flat()) {
    if (child !== undefined && child !== null) node.append(child);
  }
  return node;
}

function heading(title, description, action) {
  return element('header', 'heading',
    element('div', '', element('h1', '', title), description && element('p', '', description)),
    action);
}

function button(label, style, onClick) {
  const node = element('button', ['button', style].filter(Boolean).join(' '), label);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

function panel(title, ...children) {
  return element('section', 'panel', title && element('h2', 'subheading', title), children);
}

function empty(message) {
  return element('p', 'empty', message);
}

function notify(text) {
  clearTimeout(noticeTimeout);
  notice.textContent = text;
  if (text) noticeTimeout = setTimeout(() => { notice.textContent = ''; }, 5000);
}

function badge(text, style = '') {
  return element('span', ['pill', style].filter(Boolean).join(' '), text);
}

const labels = {
  pending: '待复核', proposed: '待发布', published: '已写入 Vault', rejected: '已退回',
  active: '已生效', superseded: '已替代', revoked: '已撤回', expired: '已到期',
  preference: '偏好', decision: '决定', lesson: '经验', event: '事件', fact_update: '事实更正', feedback: '反馈'
};

function statusBadge(value) {
  const styles = { pending: 'warn', proposed: 'warn', active: 'good', published: 'good', revoked: 'bad' };
  return badge(labels[value] || value, styles[value]);
}

function field(title, control) {
  return element('label', 'field', title, control);
}

function input(type, options = {}) {
  return Object.assign(element('input'), { type, ...options });
}

function select(options, placeholder) {
  const node = element('select');
  if (placeholder) {
    const initial = new Option(placeholder, '');
    initial.disabled = true;
    initial.selected = true;
    node.append(initial);
    node.required = true;
  }
  for (const [value, label] of options) node.append(new Option(label, value));
  return node;
}

function checkbox(label) {
  const value = input('checkbox');
  return { value, view: element('label', 'checklabel', value, label) };
}

const checks = new WeakMap();

function requireCheck(action, check) {
  const update = () => { action.disabled = !check.value.checked; };
  checks.set(action, update);
  check.value.addEventListener('change', update);
  update();
}

function details(title, ...content) {
  return element('details', '', element('summary', '', title), content);
}

function kv(pairs) {
  const list = element('dl', 'kv');
  for (const [name, value] of pairs) {
    if (value !== undefined && value !== null && value !== '') {
      list.append(element('dt', '', name), element('dd', '', value));
    }
  }
  return list;
}

function localizedTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

function statusValue(data) {
  return data.workspace?.vault?.root || data.workspace?.vault?.name || 'Vault';
}

class HttpError extends Error {
  constructor(response, body) {
    super(body?.error || '工作台请求失败。');
    this.status = response.status;
  }
}

async function call(url, action) {
  const headers = { Authorization: `Bearer ${owner}` };
  const request = { headers, credentials: 'omit', cache: 'no-store' };
  if (action) {
    headers['Content-Type'] = 'application/json';
    request.method = 'POST';
    request.body = JSON.stringify(action);
  }
  const response = await fetch(url, request);
  const body = await response.json();
  if (!response.ok) throw new HttpError(response, body);
  return body;
}

const pathQuery = path => new URLSearchParams({ path });

function runAction(form, action, handler, success, onSuccess = () => render(false)) {
  const errorBox = element('p', 'action-error');
  errorBox.setAttribute('role', 'alert');
  form.append(action, errorBox);
  action.type = 'submit';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    action.disabled = true;
    errorBox.textContent = '';
    try {
      await call('/api/action', handler());
      notify(success);
      await onSuccess();
    } catch (error) {
      errorBox.textContent = error.message;
      if (error.status === 401) showLogin(error.message);
    } finally {
      action.disabled = false;
      checks.get(action)?.();
    }
  });
  return form;
}

function documentView(note, clientOptions) {
  const workspace = element('div', 'stack');
  const draft = note.meta?.status === 'inbox';
  workspace.append(
    element('header', 'panel-head', element('h2', '', note.title || note.path)),
    element('p', 'muted small digest', note.path),
    kv([['当前版本', element('code', 'digest', note.revision)], ['出处格式', '文件与行号']])
  );
  if (draft) workspace.append(element('p', 'callout', '待整理笔记（inbox）。在 Vault 核准正文和状态后，可按新版本授权 Agent 读取。'));
  workspace.append(lines(note.text));
  const supported = clientOptions.filter(client => client.active && client.scopes?.includes('knowledge'));
  if (supported.length && !draft && note.headings?.length && note.path.toLowerCase().endsWith('.md')) {
    const clients = select(supported.map(client => [client.id, client.id]), '选择可读取知识的 Agent');
    const section = headingSelect(note);
    const check = checkbox('允许这个 Agent 读取所选章节的当前版本。');
    const form = element('form', 'stack',
      field('Agent', clients), field('分享章节', section), check.view
    );
    const submit = button('授权这一版本', 'primary');
    requireCheck(submit, check);
    runAction(form, submit, () => ({
      action: 'share', path: note.path, heading: section.value, client_id: clients.value,
      revision: note.revision, confirm: check.value.checked
    }), '已授权该 Agent 读取当前版本。', () => {
      check.value.checked = false;
    });
    workspace.append(details('向 Agent 授权章节', form));
  } else if (!supported.length && !draft) {
    workspace.append(element('p', 'callout', '先在「Agent 接入」配置知识读取身份，再为指定章节授权。'));
  }
  workspace.append(button('以此笔记新建整理任务', 'quiet', () => {
    activate('maintenance');
  }));
  return workspace;
}

function lines(text) {
  const numberLimit = 400;
  const noteLines = typeof text === 'string' ? text.split(/\r?\n/) : [];
  const list = element('ol', 'content-lines');
  list.setAttribute('aria-label', '笔记原文及行号');
  for (const line of noteLines.slice(0, numberLimit)) {
    list.append(element('li', '', element('code', '', line || '\n')));
  }
  return element('div', 'stack', list, noteLines.length > numberLimit
    ? element('p', 'muted small', `预览前 ${numberLimit} 行，共 ${noteLines.length} 行。`) : null);
}

function headingSelect(note) {
  const headings = (note.headings || []).filter(item => item.name);
  const counts = new Map();
  for (const item of headings) counts.set(item.name, 1 + (counts.get(item.name) || 0));
  return select(headings.filter(item => counts.get(item.name) === 1).map(
    item => [item.name, `${item.name} · 第 ${item.line} 行`]
  ), '选择唯一标题的章节');
}

function vaultSidebar(onSelect) {
  const folder = panel('文件目录');
  const list = element('div', 'files');
  folder.append(list);
  async function load(path, target, filterBox, root = false) {
    target.replaceChildren(element('p', 'muted-files', '正在读取目录…'));
    try {
      const children = await call(`/api/tree?${pathQuery(path)}`);
      function draw(filter) {
        target.replaceChildren();
        const matched = children.filter(entry => entry.name.toLocaleLowerCase().includes(filter));
        if (!matched.length) target.append(element('p', 'muted-files', filter ? '当前目录无匹配项。' : '当前目录为空。'));
        for (const entry of matched) {
          if (entry.folder && entry.available) {
            const nest = element('div', 'files');
            const group = details(entry.name, nest);
            group.className = 'file-group';
            group.addEventListener('toggle', () => {
              if (group.open && !group.dataset.loaded) {
                group.dataset.loaded = 'true';
                void load(entry.path, nest);
              }
            });
            target.append(group);
          } else if (entry.available) {
            const entryButton = button(entry.name, 'file-row', () => {
              for (const selected of folder.querySelectorAll('[aria-current]')) selected.removeAttribute('aria-current');
              entryButton.setAttribute('aria-current', 'true');
              void onSelect(entry.path);
            });
            target.append(entryButton);
          } else {
            const muted = element('p', 'muted-files', entry.name);
            muted.title = '该目录或文件不可预览';
            target.append(muted);
          }
        }
      }
      draw('');
      if (root) filterBox.addEventListener('input', () => draw(filterBox.value.trim().toLocaleLowerCase()));
    } catch (error) {
      target.replaceChildren(element('p', 'action-error', error.message), button('重试读取目录', '', () => {
        void load(path, target, filterBox, root);
      }));
    }
  }

  const filter = input('search', { placeholder: '筛选根目录' });
  const filterField = field('筛选当前根目录', filter);
  filterField.classList.add('vault-filter');
  list.before(filterField);
  void load('', list, filter, true);
  return folder;
}

function renderVault(container, data) {
  const documentPanel = panel(null, empty('从左侧目录打开一份笔记。'));
  let opened = 0;
  async function open(path) {
    const nonce = ++opened;
    documentPanel.replaceChildren(element('p', 'muted', '正在读取笔记…'));
    try {
      const [note, clientOptions] = await Promise.all([
        call(`/api/document?${pathQuery(path)}`),
        call('/api/share-targets')
      ]);
      if (nonce !== opened) return;
      selectedNote = note;
      documentPanel.replaceChildren(documentView(note, clientOptions));
    } catch (error) {
      if (nonce !== opened) return;
      documentPanel.replaceChildren(element('p', 'action-error', error.message));
    }
  }
  container.append(
    heading('知识 Vault', statusValue(data), button('重新读取目录', '', () => void render(false))),
    element('div', 'kb vault-layout', vaultSidebar(open), documentPanel)
  );
  if (selectedNote) void open(selectedNote.path);
}

function newJob(data) {
  if (!data.workspace.writeRoot) {
    return panel('新建整理任务', element('p', 'callout',
      '请在终端配置 Vault 内的整理输出目录，再从知识 Vault 选择笔记。现有资料可继续读取。'));
  }
  const clients = data.clients.filter(client => client.active &&
    client.scopes?.some(scope => scope === 'maintenance' || scope.startsWith('maintenance:')));
  if (!clients.length) {
    return panel('新建整理任务', element('p', 'callout', '先添加具有整理权限的 Agent，再建立任务。'));
  }
  if (!selectedNote) {
    return panel('新建整理任务', element('p', 'muted', '从「知识 Vault」打开笔记后可按章节新建任务。'),
      button('选择原件', 'quiet', () => activate('vault')));
  }

  const selectedSource = selectedNote;
  const target = input('text', { maxLength: 512, placeholder: `${data.workspace.writeRoot}/note.md`, required: true });
  const assignee = select(clients.map(client => [client.id, client.id]), '选择执行 Agent');
  const section = headingSelect(selectedSource);
  const check = checkbox('同意将所选版本及章节交给这个 Agent 处理。');
  const submit = button('创建整理任务', 'primary');
  const form = element('form', 'stack',
    kv([['原件', selectedSource.path], ['当前版本', element('code', 'digest', selectedSource.revision)]]),
    field('允许处理的章节', section), field('执行 Agent', assignee),
    field('输出笔记相对 Vault 的路径', target), check.view);
  requireCheck(submit, check);
  runAction(form, submit, () => ({
    action: 'create-job', source: selectedSource.path, heading: section.value,
    revision: selectedSource.revision, target: target.value.trim(), client_id: assignee.value,
    confirm: check.value.checked
  }), '任务已建立，等待执行 Agent 提交。');
  return panel('新建整理任务', form);
}

function reviewDraft(job) {
  const review = element('form', 'stack');
  const check = checkbox('我已核对原件、提案与写入路径。');
  const publish = button('批准并写入 Vault', 'primary');
  const comparison = element('div', 'stack', element('p', 'muted small', '打开对照，核对原件和拟新建的内容。'));
  const comparisonBox = details('对照原件与拟写入内容', comparison);
  comparisonBox.addEventListener('toggle', async () => {
    if (!comparisonBox.open || comparisonBox.dataset.loaded) return;
    comparisonBox.dataset.loaded = 'true';
    const evidence = await call(`/api/document?${pathQuery(job.source)}`).catch(() => null);
    const order = evidence?.headings || [];
    const start = order.findIndex(item => item.name === job.heading);
    const entry = order[start];
    const end = entry && order.slice(start + 1).find(item => item.depth <= entry.depth);
    const excerpt = entry ? evidence.text.split(/\r?\n/).slice(entry.line - 1, end ? end.line - 1 : undefined).join('\n') : '';
    comparison.replaceChildren(
      evidence?.revision === job.revision ? badge('原件版本一致', 'good') : badge('无法复核原件版本', 'warn'),
      excerpt && element('div', 'stack', element('h3', '', '当前原文章节'), element('pre', '', excerpt)),
      element('div', 'split equal',
        element('div', 'stack', element('h3', '', '写入前'), element('pre', '', '任务会新建笔记，现有文件不会被覆盖。')),
        element('div', 'stack', element('h3', '', '拟写入正文'), element('pre', '', job.content || '提案正文为空。'))
      )
    );
  });

  review.append(comparisonBox, check.view);
  requireCheck(publish, check);
  return runAction(review, publish, () => ({ action: 'publish-job', id: job.id, confirm: check.value.checked }),
    '提案已批准并写回 Vault。');
}

function renderJob(job) {
  const summary = element('div', 'row',
    element('div', '', element('h3', '', job.title || job.target || job.id),
      element('p', 'muted small digest', `${job.id} · ${job.client_id || '未分配'}`)),
    job.status === 'pending' ? badge('待 Agent 处理', 'info') : statusBadge(job.status));
  const info = kv([['原件', job.source], ['章节', job.heading], ['写入范围', job.target],
    ['出处', job.start_line && `第 ${job.start_line}–${job.end_line} 行`],
    ['原件版本', job.revision && element('code', 'digest', job.revision)]]);
  const record = element('article', 'panel review-card', summary, info);

  if (job.status === 'proposed') record.append(reviewDraft(job));
  if (job.status === 'pending' || job.status === 'proposed') {
    const reject = runAction(element('form', 'stack'),
      button('退回任务', 'quiet'), () => ({ action: 'reject-job', id: job.id }), '已退回。');
    record.append(details('更多操作', reject));
  }
  if (job.status === 'published') {
    record.append(button('打开已写入的笔记', 'quiet', async () => {
      try {
        selectedNote = await call(`/api/document?${pathQuery(job.target)}`);
        activate('vault');
      } catch (error) {
        notify(error.message);
      }
    }));
  }
  return record;
}

function renderMaintenance(container, data) {
  const jobs = data.jobs;
  container.append(heading('资料整理', '先指定原件版本与写入路径，再审核 Agent 提案。',
    button('刷新任务', '', () => void render(false))));
  container.append(
    element('div', 'split', newJob(data),
      element('section', 'stack',
        element('h2', '', `任务队列（${jobs.length}）`),
        jobs.length ? jobs.map(renderJob) : panel(null, empty('还没有整理任务。'))))
  );
}

function memorySummary(row) {
  const label = [labels[row.kind] || row.kind, row.version ? `v${row.version}` : '待发布'];
  const title = element('div', 'row',
    element('div', '', element('h3', '', row.key), element('p', 'muted small', label.join(' · '))),
    statusBadge(row.status));
  const content = element('pre', '', row.statement);
  const audience = row.version ? row.readers?.join('、') || '仅本人' : '待本人确认';
  const metadata = kv([
    ['提交者', row.submitted_by], ['适用情景', row.context], ['来源', row.source],
    ['访问范围', audience], ['提交时间', localizedTime(row.submitted_at)],
    ['有效期', localizedTime(row.expires_at)], ['基准版本', row.expected_version]
  ]);
  return [title, content, metadata];
}

function memoryApproval(row, available) {
  const eligible = available.filter(client => client.active && client.scopes?.includes('memory:read'));
  const choices = eligible.map(client => [client.id, checkbox(client.id)]);
  const audience = element('fieldset', '', element('legend', '', '允许读取的 Agent'));
  audience.append(choices.length
    ? element('div', 'checklist', choices.map(([, option]) => option.view))
    : element('p', 'muted small', '当前暂无可授权的 Agent。'));
  audience.append(element('p', 'muted small', '未选择时，仅本人可读取。'));
  const expiry = input('date');
  const now = new Date();
  expiry.min = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const check = checkbox('本人已确认内容、适用情景及授权范围。');
  const approval = button('本人确认并发布', 'primary');
  const form = element('form', 'stack', audience, field('有效至当天（可选）', expiry), check.view);
  requireCheck(approval, check);
  runAction(form, approval, () => ({
    action: 'approve-memory', id: row.candidate_id, confirm: check.value.checked,
    readers: choices.filter(([, option]) => option.value.checked).map(([id]) => id),
    expires_at: expiry.value ? new Date(`${expiry.value}T23:59:59.999`).toISOString() : undefined
  }), '已发布当前记忆版本。');
  return form;
}

function memoryActions(row) {
  const controls = [];
  if (row.status === 'active' || row.status === 'expired') {
    const edit = Object.assign(element('textarea'), { maxLength: 4000, rows: 4, required: true, value: row.statement });
    const context = input('text', { maxLength: 500, value: row.context || '' });
    const form = element('form', 'stack', field('更正内容', edit), field('适用情景', context));
    const pending = runAction(form, button('保存更正候选', 'primary'), () => ({
      action: 'correct-memory', key: row.key, statement: edit.value.trim(), context: context.value.trim(),
      source: row.source, kind: row.kind, expected_version: row.version
    }), '更正候选已保存，请复核发布。');
    controls.push(details('提交更正', pending));
  }
  if (row.status === 'active') {
    const check = checkbox('确认撤回这条记忆。Agent 的后续查询将无法取得它。');
    const revoke = button('撤回记忆', 'danger');
    requireCheck(revoke, check);
    const form = element('form', 'stack', check.view);
    runAction(form, revoke, () => ({ action: 'revoke-memory', key: row.key, confirm: check.value.checked }), '已撤回记忆。');
    controls.push(details('撤回共享', form));
  }
  return controls;
}

function memoryCard(row, eligible) {
  const card = element('article', 'panel review-card stack', memorySummary(row));
  if (row.status === 'pending') {
    card.append(memoryApproval(row, eligible),
      details('更多操作', runAction(element('form', 'stack'),
        button('退回候选', 'quiet'), () => ({ action: 'reject-memory', id: row.candidate_id }), '已退回记忆候选。')));
  } else {
    card.append(...memoryActions(row));
  }
  return card;
}

function renderMemory(container, data) {
  const group = ['pending', 'active', 'history'];
  const filters = [['pending', '待确认'], ['active', '已生效'], ['history', '历史']];
  const counts = new Map(group.map(state => [state, []]));
  for (const row of data.memories) {
    const state = row.status === 'pending' || row.status === 'active' ? row.status : 'history';
    counts.get(state).push(row);
  }
  const list = element('section', 'stack');
  list.setAttribute('aria-label', '记忆列表');
  const segments = element('div', 'segments');
  segments.setAttribute('aria-label', '筛选记忆状态');
  function choose(status) {
    const rows = counts.get(status);
    for (const item of segments.children) item.setAttribute('aria-pressed', String(item.dataset.status === status));
    list.replaceChildren(...(rows.length ? rows.map(row => memoryCard(row, data.clients)) :
      [panel(null, empty({
        pending: '暂无待确认的候选。可让已配置的 Agent 提交一条记忆。',
        active: '暂无已生效的记忆。',
        history: '暂无已更正、到期或撤回的记忆。'
      }[status]))]));
  }
  for (const [status, label] of filters) {
    const action = button(`${label}（${counts.get(status).length}）`, '', () => choose(status));
    action.dataset.status = status;
    segments.append(action);
  }
  container.append(heading('个人记忆', '确认后可授权给不同助手，后续可以更正或撤回。',
    button('刷新记忆', '', () => void render(false))),
    segments, list);
  choose(counts.get('pending').length ? 'pending' : counts.get('active').length ? 'active' : 'history');
}

function shareRow(share) {
  const metadata = kv([['笔记', share.path], ['章节', share.heading],
    ['版本', share.revision && element('code', 'digest', share.revision)]]);
  const revoke = runAction(element('form', 'stack'), button('撤销笔记授权', 'danger'),
    () => ({ action: 'unshare', client_id: share.client_id, path: share.path }), '已撤销这个 Agent 的笔记授权。');
  return element('div', 'row', element('div', '', element('h3', '', share.client_id), metadata),
    details('管理授权', revoke));
}

function renderAgents(container, data) {
  const listing = element('ul', 'agent-list');
  for (const client of data.clients) {
    const label = client.active ? badge('启用', 'good') : badge('已停用', 'warn');
    listing.append(element('li', '',
      element('div', 'panel-head', element('h3', '', client.id), label),
      element('p', 'muted small', client.scopes.join(' · '))));
  }
  const setup = panel('配置新连接器',
    element('p', '', '用终端创建单独身份，再把该身份的 stdio 配置导入 WorkBuddy、Codex 或其他 MCP 客户端。'),
    element('pre', 'codebox', 'memoly connector add reader --scopes knowledge,memory:read\nmemoly connector config reader'),
    element('p', 'muted small', '配置含该 Agent 的专用凭证，请在本机保存。知识按章节授权，记忆逐条决定哪些 Agent 可读。'));
  const identityPanel = panel('连接身份', data.clients.length ? listing : empty('还未配置连接器。'));
  const sharePanel = panel('已授权的知识版本', data.shares.length ? data.shares.map(shareRow) : empty('暂无对外授权。'));
  const audit = element('ol', 'log');
  for (const item of data.audit.slice(0, 20)) {
    const metadata = [localizedTime(item.at || item.time || item.timestamp || item.ts), item.client_id || item.client, item.tool || item.action, item.status]
      .filter(Boolean).join(' · ');
    audit.append(element('li', '', metadata || '本机事件'));
  }
  container.append(heading('Agent 接入', '连接器身份、知识授权和近期调用回执。',
    button('刷新连接状态', '', () => void render(false))),
    element('div', 'split equal', setup, identityPanel),
    sharePanel, panel('近期调用', audit.children.length ? audit : empty('暂无调用回执。')));
}

const screens = {
  vault: renderVault, maintenance: renderMaintenance, memory: renderMemory, agents: renderAgents
};

async function render(moveFocus = true) {
  const ticket = ++renderCount;
  const current = tab;
  const container = element('div', 'wrap', element('p', 'muted', '正在读取本机工作台…'));
  main.replaceChildren(container);
  try {
    const view = await call(`/api/state?tab=${current}`);
    if (ticket !== renderCount) return;
    nav.hidden = false;
    container.replaceChildren();
    screens[current](container, view);
    if (moveFocus) main.focus();
  } catch (error) {
    if (ticket !== renderCount) return;
    if (error.status === 401) {
      showLogin(error.message);
      return;
    }
    container.replaceChildren(heading('无法读取工作台'),
      panel(null, element('p', 'callout bad', error.message),
        button('重试', 'primary', () => void render())));
  }
}

function showLogin(problem) {
  owner = '';
  ++renderCount;
  nav.hidden = true;
  const key = input('password', { required: true, autocomplete: 'off', spellcheck: false, maxLength: 64 });
  const submit = button('打开工作台', 'primary');
  submit.type = 'submit';
  const form = element('form', 'stack', field('本机会话密钥', key), submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    owner = key.value.trim();
    void render();
  });
  const advice = problem ? element('p', 'callout warn', problem) : null;
  main.replaceChildren(element('div', 'wrap',
    heading('打开本机工作台'),
    element('section', 'panel stack setup',
      element('p', '', '用终端中启动 Memoly 时生成的地址打开，或在此输入当前会话密钥。'),
      advice, form)));
}

function activate(view) {
  if (!Object.hasOwn(screens, view)) return;
  tab = view;
  for (const action of nav.querySelectorAll('[data-tab]')) {
    if (action.dataset.tab === tab) action.setAttribute('aria-current', 'page');
    else action.removeAttribute('aria-current');
  }
  void render();
}

nav.addEventListener('click', event => {
  const view = event.target.closest('[data-tab]')?.dataset.tab;
  if (view) activate(view);
});
document.querySelector('.brand').addEventListener('click', event => {
  if (!owner) return;
  event.preventDefault();
  activate('vault');
});

if (owner) void render(false);
else showLogin();
