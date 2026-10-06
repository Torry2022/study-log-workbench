import { runScopeHandlers } from '@codemirror/view';
import { SearchQuery, getSearchQuery, setSearchQuery, findNext, findPrevious,
  selectMatches, replaceNext, replaceAll, closeSearchPanel } from '@codemirror/search';

export function createSearchPanel(view) {
  const dom = document.createElement('div');
  dom.className = 'cm-search';
  const group = (name, children) => {
    const node = document.createElement('div');
    node.className = name;
    node.append(...children);
    return node;
  };
  const field = (name, label) => {
    const node = document.createElement('input');
    node.name = name;
    node.className = 'cm-textfield';
    node.placeholder = label;
    node.setAttribute('aria-label', label);
    node.autocomplete = 'off';
    node.spellcheck = false;
    return node;
  };
  const button = (name, label, command) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.name = name;
    node.className = 'cm-button';
    node.textContent = label;
    node.onclick = () => command(view);
    return node;
  };
  const search = field('search', '查找');
  search.setAttribute('main-field', 'true');
  const replace = field('replace', '替换');
  const options = ['区分大小写', '正则表达式', '全字匹配'].map(text => {
    const label = document.createElement('label');
    label.title = text === '正则表达式' ? '将查找内容作为正则表达式' :
      (text === '全字匹配' ? '仅匹配完整单词' : '区分英文字母大小写');
    const input = document.createElement('input');
    input.type = 'checkbox';
    label.append(input, text);
    return { label, input };
  });
  const close = button('close', '×', closeSearchPanel);
  close.setAttribute('aria-label', '关闭');
  close.title = '关闭查找替换';
  dom.append(group('search-row', [search,
    group('search-actions', [button('next', '下一个', findNext), button('prev', '上一个', findPrevious), button('select', '全选', selectMatches)])]));
  if (!view.state.readOnly) dom.append(group('replace-row', [replace,
    group('search-actions', [button('replace', '替换', replaceNext), button('replaceAll', '全部替换', replaceAll)])]));
  dom.append(group('search-options', options.map(option => option.label)), close);
  const sync = () => {
    const query = getSearchQuery(view.state);
    search.value = query.search;
    replace.value = query.replace;
    [query.caseSensitive, query.regexp, query.wholeWord].forEach((checked, index) => options[index].input.checked = checked);
  };
  dom.addEventListener('input', () => view.dispatch({ effects:setSearchQuery.of(new SearchQuery({
    search:search.value, replace:replace.value, caseSensitive:options[0].input.checked,
    regexp:options[1].input.checked, wholeWord:options[2].input.checked
  })) }));
  dom.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault();
    else if (event.key === 'Enter') {
      if (event.target === search) (event.shiftKey ? findPrevious : findNext)(view);
      else if (event.target === replace) replaceNext(view);
      else return;
      event.preventDefault();
    }
  });
  sync();
  return { dom, top:true, mount:() => search.select(), update(update) {
    if (update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setSearchQuery)))) sync();
  } };
}
