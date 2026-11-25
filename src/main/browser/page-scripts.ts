/**
 * Scripts the app runs inside the Chrome tab. Each is a string evaluated in
 * the page; they share nothing with the app's own code.
 */

/**
 * The submit guard, installed in every document the followed tab loads. A
 * form submit that happens within a moment of the app's own click or key
 * press is blocked, unless an approved submit opened the gate, or the button
 * that sent it only moves a multi-page form along (Next, Continue, Review).
 * The user's own clicks never set `acting`, so they are never blocked.
 */
export const GUARD_SCRIPT = `(() => {
  if (window.__jobappGuard) return;
  const guard = { until: 0, acting: 0, blocked: 0, blockedLabel: '' };
  Object.defineProperty(window, '__jobappGuard', { value: guard, writable: false, configurable: false });
  const isStep = el => /^(next|continue|review|save and continue|proceed)\\b/i.test(
    ((el && (el.innerText || el.value || el.getAttribute('aria-label'))) || '').trim());
  const isBlocked = submitter => {
    const now = Date.now();
    return now < guard.acting && now >= guard.until && !isStep(submitter);
  };
  window.addEventListener('submit', event => {
    if (!isBlocked(event.submitter)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    guard.blocked = Date.now();
    guard.blockedLabel = ((event.submitter && (event.submitter.innerText || event.submitter.value)) || 'a form').trim().slice(0, 60);
  }, true);
  for (const name of ['submit', 'requestSubmit']) {
    const original = HTMLFormElement.prototype[name];
    if (!original) continue;
    HTMLFormElement.prototype[name] = function (...args) {
      if (isBlocked(args[0])) { guard.blocked = Date.now(); guard.blockedLabel = 'a form'; return; }
      return original.apply(this, args);
    };
  }
})();`

export type ReadScope = 'auto' | 'page'

/**
 * Reads the tab: its URL, title, the text of the part that matters, and a
 * numbered list of what can be clicked or typed into there. An open dialog is
 * read on its own, since forms such as Easy Apply live in one; otherwise the
 * page's main region; `page` reads everything. Each listed element is tagged
 * with its number so the other tools find it again.
 */
export const readScript = (scope: ReadScope, maxChars: number, maxElements: number): string => `(() => {
  const isShown = el => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const clean = text => (text || '').replace(/\\s+/g, ' ').trim();
  const pick = () => {
    if (${JSON.stringify(scope)} === 'page') return { root: document.body, name: 'whole page' };
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')].filter(isShown);
    if (dialogs.length) return { root: dialogs[dialogs.length - 1], name: 'open dialog' };
    const main = [...document.querySelectorAll('main, [role="main"]')].find(isShown);
    return main ? { root: main, name: 'main region' } : { root: document.body, name: 'whole page' };
  };
  const { root, name } = pick();
  const labelOf = el => {
    const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const byAria = el.getAttribute('aria-labelledby');
    const aria = byAria ? byAria.split(' ').map(id => document.getElementById(id)).filter(Boolean).map(n => n.innerText).join(' ') : '';
    const wrap = el.closest('label');
    const legend = (el.type === 'radio' || el.type === 'checkbox') ? el.closest('fieldset')?.querySelector('legend')?.innerText : '';
    return clean(el.getAttribute('aria-label') || aria || (byFor && byFor.innerText) || (wrap && wrap.innerText) ||
      el.getAttribute('placeholder') || el.getAttribute('name') || el.innerText || el.value || el.getAttribute('title') || '').slice(0, 100)
      + (legend ? ' (in: ' + clean(legend).slice(0, 80) + ')' : '');
  };
  document.querySelectorAll('[data-jobapp-ref]').forEach(el => el.removeAttribute('data-jobapp-ref'));
  // Sites often hide a radio or checkbox and show its label instead: list it when its label shows.
  const labelShown = el => {
    const label = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
    return !!label && isShown(label);
  };
  const found = [...root.querySelectorAll(
    'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="combobox"], [role="checkbox"], [role="radio"], [contenteditable="true"]'
  )].filter(el => isShown(el) || (el.tagName === 'INPUT' && (el.type === 'file' || ((el.type === 'radio' || el.type === 'checkbox') && labelShown(el)))))
    .slice(0, ${maxElements});
  const elements = found.map((el, i) => {
    const ref = i + 1;
    el.setAttribute('data-jobapp-ref', String(ref));
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || el.getAttribute('role') || '';
    let line = '[' + ref + '] ' + tag + (type ? '(' + type + ')' : '') + ' "' + labelOf(el) + '"';
    if (el.required || el.getAttribute('aria-required') === 'true') line += ' required';
    if (tag === 'a') line += ' -> ' + el.href.slice(0, 200);
    if (tag === 'select') {
      const options = [...el.options].map(o => clean(o.text)).filter(Boolean);
      line += ' options: ' + options.slice(0, 12).join(' | ') + (options.length > 12 ? ' | ... ' + (options.length - 12) + ' more' : '') + ' (now: ' + clean(el.options[el.selectedIndex]?.text) + ')';
    }
    else if (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'submit', 'button', 'file', 'hidden'].includes(el.type))) {
      if (el.value) line += ' value: "' + clean(el.value).slice(0, 80) + '"';
    }
    if (el.type === 'checkbox' || el.type === 'radio') line += el.checked ? ' [checked]' : ' [not checked]';
    if (el.disabled) line += ' [disabled]';
    return line;
  });
  // A long select's options would fill the text: the element list carries them instead.
  let all = root.innerText || '';
  for (const select of root.querySelectorAll('select')) {
    const options = select.innerText;
    if (options && options.length > 200) all = all.replace(options, '[options: see the element list]');
  }
  return {
    url: location.href,
    title: document.title,
    scope: name,
    text: all.replace(/\\n{3,}/g, '\\n\\n').slice(0, ${maxChars}),
    isCut: all.length > ${maxChars},
    elements,
  };
})()`

/** Words on a control that would send something; `refuse` adds the flow's own, such as apply in a hunt. */
export const clickScript = (ref: number, refuse: string): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]');
  if (!el) return { error: 'No element ${ref} on this page now. Read the page again.' };
  const words = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
  const isStep = /^(next|continue|review|save and continue|proceed)\\b/i.test(words);
  const isSubmitButton = el.tagName === 'BUTTON' && (el.getAttribute('type') || 'submit') === 'submit' && el.form && !isStep;
  const isSubmitInput = el.tagName === 'INPUT' && ['submit', 'image'].includes(el.type) && !isStep;
  if (isSubmitButton || isSubmitInput || new RegExp(${JSON.stringify(refuse)}, 'i').test(words)) {
    return { refused: 'Element ${ref} ("' + words.slice(0, 40) + '") would send something. That is not allowed with click here.' };
  }
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`

/** Finds element `ref` and answers its centre, for a click the app itself decided on. */
export const pointScript = (ref: number): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]');
  if (!el) return { error: 'No element ${ref} on this page now. Read the page again.' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`

export type FieldKind = 'text' | 'combobox' | 'select' | 'radio' | 'checkbox' | 'file' | 'button' | 'other'

/**
 * What kind of field element `ref` is, whether it is ticked, and where to
 * click to change it: a hidden radio or checkbox is clicked through its label.
 */
export const fieldScript = (ref: number): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]');
  if (!el) return { error: 'No element ${ref} on this page now. Read the page again.' };
  const tag = el.tagName;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const role = el.getAttribute('role') || '';
  const kind = tag === 'SELECT' ? 'select'
    : type === 'file' ? 'file'
    : type === 'radio' || role === 'radio' ? 'radio'
    : type === 'checkbox' || role === 'checkbox' || role === 'switch' ? 'checkbox'
    : role === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' ? 'combobox'
    : tag === 'TEXTAREA' || el.isContentEditable || (tag === 'INPUT' && !['submit', 'button', 'image', 'reset', 'hidden'].includes(type)) ? 'text'
    : tag === 'BUTTON' || role === 'button' ? 'button' : 'other';
  const checked = el.checked === true || el.getAttribute('aria-checked') === 'true';
  let target = el;
  const box = el.getBoundingClientRect();
  if ((kind === 'radio' || kind === 'checkbox') && (box.width < 6 || box.height < 6 || getComputedStyle(el).opacity === '0')) {
    target = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label') || el;
  }
  target.scrollIntoView({ block: 'center', inline: 'center' });
  const at = target.getBoundingClientRect();
  return { kind, checked, x: at.left + Math.min(at.width / 2, 12), y: at.top + at.height / 2 };
})()`

/** The suggestion a type-ahead field shows that best matches `text`, as a point to click. */
export const suggestionScript = (text: string): string => `(() => {
  const isShown = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const options = [...document.querySelectorAll('[role="listbox"] [role="option"], [role="listbox"] li')].filter(isShown);
  if (!options.length) return { none: true };
  const wanted = ${JSON.stringify(text)}.trim().toLowerCase();
  const pick = options.find(o => o.innerText.trim().toLowerCase() === wanted)
    || options.find(o => o.innerText.trim().toLowerCase().startsWith(wanted))
    || options.find(o => o.innerText.trim().toLowerCase().includes(wanted))
    || options[0];
  pick.scrollIntoView({ block: 'nearest' });
  const box = pick.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, text: pick.innerText.trim().slice(0, 80) };
})()`

/** Focuses text field `ref` and selects what it holds, so typing replaces it. */
export const focusScript = (ref: number): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]');
  if (!el) return { error: 'No element ${ref} on this page now. Read the page again.' };
  const isField = el.tagName === 'TEXTAREA' || el.isContentEditable ||
    (el.tagName === 'INPUT' && !['submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'hidden'].includes(el.type));
  if (!isField) return { error: 'Element ${ref} is not a text field.' };
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (typeof el.select === 'function') el.select();
  else document.execCommand('selectAll');
  return { ok: true };
})()`

/** Picks an option in select `ref` by its text or value, as a person choosing it would. */
export const chooseScript = (ref: number, option: string): string => `(() => {
  const el = document.querySelector('[data-jobapp-ref="${ref}"]');
  if (!el) return { error: 'No element ${ref} on this page now. Read the page again.' };
  if (el.tagName !== 'SELECT') return { error: 'Element ${ref} is not a select. For a custom dropdown, click it, read the page, then click the option.' };
  const wanted = ${JSON.stringify(option)}.trim().toLowerCase();
  const options = [...el.options];
  const match = options.find(o => o.text.trim().toLowerCase() === wanted || o.value.toLowerCase() === wanted)
    || options.find(o => o.text.trim().toLowerCase().includes(wanted));
  if (!match) return { error: 'No option like "' + ${JSON.stringify(option)} + '". Options: ' + options.map(o => o.text.trim()).join(' | ') };
  el.value = match.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { chosen: match.text.trim() };
})()`

/**
 * Finds the file field to upload into: element `ref` when given, else the
 * first file input in an open dialog or the main region, hidden ones too,
 * since sites often hide the real input behind a styled button. Tags it so
 * the app can set its files.
 */
export const fileInputScript = (ref: number | null): string => `(() => {
  document.querySelectorAll('[data-jobapp-upload]').forEach(el => el.removeAttribute('data-jobapp-upload'));
  let el = ${ref === null ? 'null' : `document.querySelector('[data-jobapp-ref="${ref}"]')`};
  if (el && !(el.tagName === 'INPUT' && el.type === 'file')) el = el.querySelector('input[type="file"]') || el.closest('label, div')?.querySelector('input[type="file"]');
  if (!el) {
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')];
    const scope = dialogs[dialogs.length - 1] || document.querySelector('main, [role="main"]') || document.body;
    el = scope.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
  }
  if (!el) return { error: 'There is no file field on this page. Read the page again, or click the upload button first.' };
  el.setAttribute('data-jobapp-upload', '1');
  return { accept: el.getAttribute('accept') || '', name: el.getAttribute('name') || '' };
})()`

/** A field of the form on the page, as FORM_SCRIPT reads it. */
export type PageField = {
  key: string
  label: string
  kind: 'text' | 'longtext' | 'select' | 'radio' | 'checkbox' | 'combobox' | 'file'
  options: string[] | null
  value: string
  isRequired: boolean
  isReadOnly: boolean
}

/** The form on the page: its fields in the page's order, and the dialog or form they sit in. */
export type PageForm = { url: string; title: string; group: string; fields: PageField[] }

/** What the form scripts share: how a field's words are read, the same way each time. */
const FORM_HELPERS = String.raw`
  const clean = text => (text || '').replace(/\s+/g, ' ').trim();
  // Sites often say a label twice, once for screen readers: "Email Email" is "Email".
  const once = text => { const twice = text.match(/^(.+?)\s+\1$/s); return twice ? twice[1] : text; };
  const textOf = ids => (ids || '').split(' ').map(id => document.getElementById(id)).filter(Boolean).map(node => node.innerText).join(' ');
  const labelFor = el => (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
  const labelOf = el => {
    const label = labelFor(el);
    // A label can run to a page of legal text: its start names the field.
    return once(clean(el.getAttribute('aria-label') || textOf(el.getAttribute('aria-labelledby')) || (label && label.innerText) || el.getAttribute('placeholder') || el.getAttribute('title') || '').slice(0, 600)).slice(0, 300);
  };
  const optionOf = el => labelOf(el) || clean(el.value);
`

/**
 * Reads the application form on the page as data: each field's question, its
 * kind, its choices and what it holds now. Radio buttons that answer one
 * question come as one field. An open dialog is read on its own; otherwise the
 * form with most of the page's fields, or the page's main region. A page with
 * a stray field or two is not a form: it answers no fields. Passwords and
 * search boxes are never read. Each field is tagged with its key, which stays
 * the same from one reading to the next, so the app can find it again.
 */
export const FORM_SCRIPT = String.raw`(() => {
  ${FORM_HELPERS}
  const isShown = el => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const NEVER = ['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search'];
  const isField = el => {
    if (el.closest('[role="search"]')) return false;
    const role = el.getAttribute('role') || '';
    // A styled wrapper around a real control: the control itself is read.
    if (el.tagName !== 'INPUT' && ['radio', 'checkbox', 'switch', 'combobox'].includes(role) && el.querySelector('input, textarea, select')) return false;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (NEVER.includes(type)) return false;
      // Sites hide the real file input behind a styled button: it counts while what holds it is on the page, not on a step that is hidden.
      if (type === 'file') return getComputedStyle(el).display === 'none' ? !!el.parentElement && el.parentElement.getClientRects().length > 0 : el.getClientRects().length > 0;
      // Sites often hide a radio or checkbox and show its label instead.
      if (type === 'radio' || type === 'checkbox') { const label = labelFor(el); return isShown(el) || (!!label && isShown(label)); }
    }
    return isShown(el);
  };
  const FIELDS = 'input, select, textarea, [contenteditable="true"], [role="combobox"], [role="radio"], [role="checkbox"], [role="switch"]';
  const fieldsIn = root => [...root.querySelectorAll(FIELDS)].filter(isField);
  const pick = () => {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')].filter(isShown);
    const dialog = dialogs[dialogs.length - 1];
    if (dialog && fieldsIn(dialog).length) {
      const heading = dialog.querySelector('h1, h2, h3, [role="heading"]');
      return { root: dialog, min: 1, group: 'dialog:' + clean(dialog.getAttribute('aria-label') || textOf(dialog.getAttribute('aria-labelledby')) || (heading && heading.innerText)).slice(0, 80) };
    }
    const region = [...document.querySelectorAll('main, [role="main"]')].find(isShown) || document.body;
    const inRegion = fieldsIn(region).length;
    const forms = [...document.querySelectorAll('form')].filter(form => isShown(form) && !form.closest('[role="search"]')).map(form => ({ form, count: fieldsIn(form).length })).sort((a, b) => b.count - a.count);
    const best = forms[0];
    // One form holding most of the page's fields is the application; fields spread wider are read from the region.
    if (best && best.count >= 2 && (inRegion < 3 || best.count >= inRegion * 0.6)) {
      return { root: best.form, min: 1, group: 'form:' + (best.form.id || best.form.getAttribute('name') || best.form.getAttribute('action') || '').slice(0, 80) };
    }
    return { root: region, min: 3, group: 'page' };
  };
  const { root, min, group } = pick();

  const groupOf = el => el.closest('fieldset, [role="radiogroup"], [role="group"]');
  const groupLabel = el => {
    const set = groupOf(el);
    if (!set) return '';
    const legend = set.querySelector('legend');
    return once(clean((legend && legend.innerText) || set.getAttribute('aria-label') || textOf(set.getAttribute('aria-labelledby'))).slice(0, 600)).slice(0, 300);
  };
  const kindOf = el => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = el.getAttribute('role') || '';
    if (el.tagName === 'SELECT') return 'select';
    if (type === 'file') return 'file';
    if (type === 'radio' || role === 'radio') return 'radio';
    if (type === 'checkbox' || role === 'checkbox' || role === 'switch') return 'checkbox';
    if (role === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') return 'combobox';
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return 'longtext';
    return 'text';
  };
  const isOn = el => el.checked === true || el.getAttribute('aria-checked') === 'true';
  // The first line of a dropdown that stands for no choice yet.
  const EMPTY = /^(select|choose|please select|pick)\b|^-+$/i;
  const optionsOf = el => [...el.options].map(option => clean(option.text)).filter((text, i) => text && !(i === 0 && EMPTY.test(text))).slice(0, 400);
  const valueOf = (el, kind) => {
    if (kind === 'select') {
      const option = el.options[el.selectedIndex];
      if (!option || !option.value || (el.selectedIndex === 0 && EMPTY.test(clean(option.text)))) return '';
      return clean(option.text);
    }
    if (kind === 'checkbox') return isOn(el) ? 'Yes' : 'No';
    if (kind === 'file') return [...(el.files || [])].map(file => file.name).join(', ');
    if (kind === 'combobox' && el.tagName !== 'INPUT') { const text = clean(el.innerText); return EMPTY.test(text) ? '' : text.slice(0, 300); }
    if (kind === 'combobox' && !el.value) {
      // A styled dropdown shows its choice beside an empty input.
      const shell = el.closest('[class*="control"], [class*="select"]');
      const text = shell ? clean(shell.innerText) : '';
      return text && text.length <= 120 && !EMPTY.test(text) && text !== clean(el.getAttribute('placeholder')) ? text : '';
    }
    if (el.isContentEditable) return (el.innerText || '').trim();
    return el.value || '';
  };

  const fields = [];
  const radios = new Map();
  for (const el of fieldsIn(root)) {
    const kind = kindOf(el);
    const isRequired = el.required === true || el.getAttribute('aria-required') === 'true';
    const isReadOnly = el.disabled === true || el.readOnly === true || el.getAttribute('aria-disabled') === 'true';
    if (kind === 'radio') {
      const set = groupOf(el);
      const name = el.getAttribute('name');
      const id = name ? 'name:' + name : set || el.parentElement;
      let field = radios.get(id);
      if (!field) {
        field = { els: [], label: groupLabel(el) || clean(name), kind, options: [], value: '', isRequired: !!set && set.getAttribute('aria-required') === 'true', isReadOnly: false };
        radios.set(id, field);
        fields.push(field);
      }
      const option = optionOf(el);
      field.els.push(el);
      field.options.push(option);
      if (isOn(el)) field.value = option;
      field.isRequired = field.isRequired || isRequired;
      field.isReadOnly = field.isReadOnly || isReadOnly;
      continue;
    }
    let label = labelOf(el);
    if (kind === 'checkbox') {
      // One of several boxes under a question: the question, then the box.
      const set = groupOf(el);
      const over = groupLabel(el);
      if (set && over && over !== label && set.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length > 1) label = over + ': ' + label;
    }
    if (!label) label = groupLabel(el) || clean(el.getAttribute('name')) || clean(el.id);
    fields.push({ els: [el], label, kind, options: kind === 'select' ? optionsOf(el) : null, value: valueOf(el, kind), isRequired, isReadOnly });
  }

  document.querySelectorAll('[data-jobapp-field]').forEach(el => el.removeAttribute('data-jobapp-field'));
  const used = new Map();
  const out = fields.map(field => {
    const isRequired = field.isRequired || /\*\s*$/.test(field.label);
    const label = field.label.replace(/\s*\*+\s*$/, '').trim() || 'Unnamed field';
    const base = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || field.kind;
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    const key = count === 1 ? base : base + '-' + count;
    for (const el of field.els) el.setAttribute('data-jobapp-field', key);
    return { key, label, kind: field.kind, options: field.options, value: field.value.slice(0, 20000), isRequired, isReadOnly: field.isReadOnly };
  });
  return { url: location.href, title: document.title, group, fields: out.length >= min ? out : [] };
})()`

/**
 * Finds the element of form field `key` to set to `value` (for radio buttons,
 * the one with those words) and answers its number for the field tools,
 * giving it one when the last reading gave none.
 */
export const fieldRefScript = (key: string, value: string): string => String.raw`(() => {
  ${FORM_HELPERS}
  const els = [...document.querySelectorAll('[data-jobapp-field]')].filter(el => el.getAttribute('data-jobapp-field') === ${JSON.stringify(key)});
  if (!els.length) return { error: 'That field is not on the page now.' };
  let el = els[0];
  if (el.type === 'radio' || el.getAttribute('role') === 'radio') {
    const wanted = clean(${JSON.stringify(value)}).toLowerCase();
    el = els.find(one => optionOf(one).toLowerCase() === wanted) || els.find(one => optionOf(one).toLowerCase().includes(wanted));
    if (!el) return { error: 'It has no choice with those words.' };
  }
  let ref = Number(el.getAttribute('data-jobapp-ref')) || 0;
  if (!ref) {
    ref = Math.max(9000, ...[...document.querySelectorAll('[data-jobapp-ref]')].map(one => Number(one.getAttribute('data-jobapp-ref')) || 0)) + 1;
    el.setAttribute('data-jobapp-ref', String(ref));
  }
  return { ref };
})()`

/** The form field each numbered element belongs to, by its key; "" for one that is no field, or gone. */
export const fieldKeysScript = (refs: number[]): string =>
  `${JSON.stringify(refs)}.map(ref => { const el = document.querySelector('[data-jobapp-ref="' + ref + '"]'); return (el && el.getAttribute('data-jobapp-field')) || ''; })`

/**
 * Why the browser itself would refuse to send the form that button `ref`
 * submits: the questions of its fields that are required and empty, or hold
 * something the page calls invalid. None for a form the site checks itself,
 * or a button outside any form.
 */
export const invalidScript = (ref: number): string => String.raw`(() => {
  ${FORM_HELPERS}
  const el = document.querySelector('[data-jobapp-ref="${ref}"]');
  const form = el && (el.form || el.closest('form'));
  if (!form || form.noValidate || form.checkValidity()) return [];
  return [...form.elements].filter(one => one.willValidate && !one.checkValidity()).slice(0, 12)
    .map(one => (labelOf(one) || clean(one.getAttribute('name')) || 'a field') + ': ' + (one.validationMessage || 'not valid'));
})()`
