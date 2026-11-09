/** A searchable checkbox menu for one dimension of the trend chart. */
export function createTrendPicker(host, name, onChange) {
 const field = document.createElement('span');
 const picker = document.createElement('details');
 const summary = document.createElement('summary');
 const menu = document.createElement('div');
 const search = document.createElement('input');
 const actions = document.createElement('div');
 const choices = document.createElement('div');
 field.textContent = name;
 picker.className = 'trend-picker';
 menu.className = 'trend-picker-menu';
 search.type = 'search';
 search.placeholder = '搜尋' + name;
 search.setAttribute('aria-label', search.placeholder);
 actions.className = 'row';
 choices.className = 'trend-options';
 choices.setAttribute('role', 'group');
 choices.setAttribute('aria-label', '選擇' + name);
 menu.append(search, actions, choices);
 picker.append(summary, menu);
 host.append(field, picker);

 let options = [], selected = null, allLabel = '全部' + name;
 function renderSummary() {
  summary.textContent = selected === null ? allLabel : '已選 ' + selected.size + '／' + options.length;
  summary.setAttribute('aria-label', name + '：' + summary.textContent);
 }
 function renderChoices() {
  const query = search.value.trim().normalize('NFKC').toLowerCase();
  choices.replaceChildren();
  for (const [key, label] of options) {
   if (!label.normalize('NFKC').toLowerCase().includes(query)) continue;
   const row = document.createElement('label');
   const check = document.createElement('input');
   check.type = 'checkbox';
   check.value = key;
   check.checked = selected === null || selected.has(key);
   check.onchange = () => {
    selected ??= new Set(options.map(([value]) => value));
    if (check.checked) selected.add(key);
    else selected.delete(key);
    if (selected.size === options.length) selected = null;
    renderSummary();
    onChange();
   };
   row.append(check, label);
   choices.append(row);
  }
  if (!choices.children.length) choices.textContent = options.length ? '沒有符合的' + name : '目前沒有可選的' + name;
 }
 function close() {
  picker.open = false;
  summary.focus({preventScroll: true});
 }
 for (const [label, action] of [
  ['全選', () => { selected = null; update(); }],
  ['清除選取', () => { selected = new Set(); update(); }],
  ['關閉', close]
 ]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  button.onclick = action;
  actions.append(button);
 }
 function update() {
  renderSummary();
  renderChoices();
  onChange();
 }
 search.oninput = renderChoices;
 picker.onkeydown = event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  close();
 };
 document.addEventListener('pointerdown', event => {
  if (!picker.contains(event.target)) picker.open = false;
 });
 renderSummary();
 return {
  setOptions(values, selection = selected, label = '全部' + name) {
   options = values;
   selected = selection === null ? null : new Set(values.filter(([key]) => selection.has(key)).map(([key]) => key));
   allLabel = label;
   renderSummary();
   renderChoices();
  },
  get selection() { return selected; },
  get label() {
   return selected === null ? allLabel : options.filter(([key]) => selected.has(key)).map(([, label]) => label).join('、') || '未選' + name;
  }
 };
}
