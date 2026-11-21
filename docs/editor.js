/* A small code editor for the docs' live examples, drawn like the one in shCode's docs:
   line numbers, Dracula colours, Tab indents two spaces, Ctrl/Cmd+Enter runs.

   It is a plain <textarea> with the coloured copy of the code drawn behind it, so typing, selecting, undo,
   paste and the phone keyboard are all the browser's own. No dependencies and no build step.
   The same file is used by the moSHion docs (github.com/shuff57/moshion), so keep the two copies identical.

     const ed = makeEditor({ label: 'Code for the example', onRun() {}, onChange() {} });
     container.append(ed.el);        // fill its parent: the parent needs a height and position: relative
     ed.setValue(code);  ed.getValue();  ed.textarea;
*/
(function () {
  var STYLE = [
    '.cm { position: absolute; inset: 0; display: flex; background: var(--code-bg, #1e1f29); color: var(--code-fg, #f8f8f2); font: 13px/1.55 "Fira Code", Consolas, "Courier New", monospace; font-variant-ligatures: none; }',
    '.cm-gutter { flex: none; box-sizing: border-box; min-width: 44px; padding: 8px 10px 8px 8px; overflow: hidden; text-align: right; color: #6272a4; white-space: pre; user-select: none; }',
    '.cm-view { position: relative; flex: 1; min-width: 0; overflow: hidden; }',
    '.cm-hl, .cm-ta { position: absolute; inset: 0; box-sizing: border-box; margin: 0; padding: 8px 12px; border: 0; font: inherit; font-variant-ligatures: none; letter-spacing: normal; tab-size: 2; white-space: pre; }',
    '.cm-hl { overflow: visible; pointer-events: none; color: inherit; width: max-content; min-width: 100%; height: max-content; min-height: 100%; }',
    '.cm-ta { width: 100%; height: 100%; overflow: auto; resize: none; background: transparent; color: transparent; caret-color: var(--code-fg, #f8f8f2); outline: none; }',
    '.cm-ta::selection { background: rgb(68 71 90 / .9); color: transparent; }',
    '.cm-hl .c { color: #6272a4; font-style: italic; } .cm-hl .s { color: #f1fa8c; } .cm-hl .n { color: #bd93f9; }',
    '.cm-hl .k { color: #ff79c6; } .cm-hl .f { color: #50fa7b; } .cm-hl .t { color: #8be9fd; font-style: italic; }',
    '.cm:focus-within { box-shadow: inset 0 0 0 1px rgb(91 170 253 / .6); }'
  ].join('\n');
  var TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?|`(?:[^`\\]|\\[\s\S])*`?)|(\b\d[\d_]*(?:\.\d+)?\b)|\b(let|const|var|function|return|if|else|for|while|do|new|of|in|true|false|null|undefined|this|class|extends|break|continue|switch|case|default|typeof|async|await|throw|try|catch)\b|([A-Za-z_$][\w$]*)(?=\s*\()|\b([A-Z][A-Za-z0-9]*)\b/g;
  var CLASSES = ['', 'c', 's', 'n', 'k', 'f', 't'];

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function paint(code) {
    var out = '', last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(code))) {
      if (m[0] === '') { TOKEN.lastIndex++; continue; }
      var i = 1; while (!m[i]) i++;
      out += esc(code.slice(last, m.index)) + '<span class="' + CLASSES[i] + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last)) + '\n';   // the extra newline keeps a final empty line the same height as the textarea's
  }

  window.makeEditor = function (opts) {
    opts = opts || {};
    if (!document.getElementById('cm-style')) {
      var st = document.createElement('style'); st.id = 'cm-style'; st.textContent = STYLE; document.head.appendChild(st);
    }
    var el = document.createElement('div'); el.className = 'cm';
    var gutter = document.createElement('div'); gutter.className = 'cm-gutter'; gutter.setAttribute('aria-hidden', 'true');
    var view = document.createElement('div'); view.className = 'cm-view';
    var hl = document.createElement('pre'); hl.className = 'cm-hl'; hl.setAttribute('aria-hidden', 'true');
    var ta = document.createElement('textarea'); ta.className = 'cm-ta';
    ta.spellcheck = false; ta.autocapitalize = 'off'; ta.setAttribute('autocomplete', 'off'); ta.setAttribute('wrap', 'off');
    if (opts.label) ta.setAttribute('aria-label', opts.label);
    view.append(hl, ta); el.append(gutter, view);

    function draw() {
      var v = ta.value, n = v.split('\n').length, g = '';
      for (var i = 1; i <= n; i++) g += i + '\n';
      gutter.textContent = g;
      hl.innerHTML = paint(v);
      sync();
    }
    function sync() {
      hl.style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
      gutter.scrollTop = ta.scrollTop;
    }
    ta.addEventListener('input', function () { draw(); if (opts.onChange) opts.onChange(ta.value); });
    ta.addEventListener('scroll', sync);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (opts.onRun) opts.onRun(); }
      else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      }
    });
    return {
      el: el, textarea: ta,
      getValue: function () { return ta.value; },
      setValue: function (v) { ta.value = v; ta.scrollTop = 0; ta.scrollLeft = 0; draw(); }
    };
  };
})();
