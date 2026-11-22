'use strict';

const memoryStates = {
  pending: ['not_found_or_unavailable', '候选已提交，Codex 暂时读不到任何正文。'],
  v1: ['ok · v1', '交接说明先列里程碑，再列行动项。'],
  edit: ['ok · v1', '更正等待确认。Codex 仍读到 v1：交接说明先列里程碑，再列行动项。'],
  v2: ['ok · v2', '交接说明先列风险，再列里程碑。'],
  revoked: ['not_found_or_unavailable', '记忆已撤回。Codex 的新查询没有正文。']
};
const citations = {
  '6': '审核人不在时，保留演练工单，等下一班次处理。',
  '7': '编号为 MEMOLY-DEMO-314。'
};

function selectButton(buttons, active, attribute) {
  buttons.forEach(button => button.setAttribute(attribute, String(button === active)));
}

const tabs = [...document.querySelectorAll('[data-tabs] [role="tab"]')];
function activateTab(active) {
  selectButton(tabs, active, 'aria-selected');
  for (const button of tabs) {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    const selected = button === active;
    button.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', event => {
    const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    let target;
    if (offset) target = tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length];
    if (event.key === 'Home') target = tabs[0];
    if (event.key === 'End') target = tabs.at(-1);
    if (!target) return;
    event.preventDefault();
    activateTab(target);
    target.focus();
  });
}

const citationButtons = [...document.querySelectorAll('[data-cite]')];
for (const button of citationButtons) {
  button.addEventListener('click', () => {
    const lineNumber = button.dataset.cite;
    selectButton(citationButtons, button, 'aria-pressed');
    for (const line of document.querySelectorAll('[data-source-line]')) {
      line.querySelector('mark').dataset.active = String(line.dataset.sourceLine === lineNumber);
    }
    document.querySelector('#citation-result').textContent = citations[lineNumber];
  });
}

const memoryButtons = [...document.querySelectorAll('[data-memory]')];
for (const button of memoryButtons) {
  button.addEventListener('click', () => {
    selectButton(memoryButtons, button, 'aria-pressed');
    const [code, result] = memoryStates[button.dataset.memory];
    document.querySelector('#memory-code').textContent = code;
    document.querySelector('#memory-result').textContent = result;
  });
}

const copy = document.querySelector('[data-copy]');
copy.addEventListener('click', async () => {
  const source = document.getElementById(copy.dataset.copy);
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(source.textContent);
    status.textContent = '命令已复制。';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = '命令已选中，可以按系统快捷键复制。';
  }
});

const header = document.querySelector('.site-header');
function updateHeader() {
  header.dataset.scrolled = String(window.scrollY > 32);
}
window.addEventListener('scroll', updateHeader, { passive: true });
window.addEventListener('pageshow', updateHeader);
updateHeader();

document.documentElement.classList.add('has-js');
