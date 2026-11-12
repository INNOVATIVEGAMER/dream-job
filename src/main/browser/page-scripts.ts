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
    : type === 'checkbox' || role === 'checkbox' ? 'checkbox'
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
