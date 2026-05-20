// popup.js — wires up UI, persists prefs, injects the fill function into the page.

document.addEventListener('DOMContentLoaded', () => {
  const breakStartEl = document.getElementById('breakStart');
  const breakEndEl   = document.getElementById('breakEnd');

  // Restore saved prefs
  chrome.storage.local.get(['breakStart', 'breakEnd'], (r) => {
    if (r.breakStart) breakStartEl.value = r.breakStart;
    if (r.breakEnd)   breakEndEl.value   = r.breakEnd;
  });

  document.getElementById('fillBtn').addEventListener('click', () => run(false));
  document.getElementById('fillSubmitBtn').addEventListener('click', () => run(true));
});

async function run(doSubmit) {
  const breakStart = document.getElementById('breakStart').value.trim();
  const breakEnd   = document.getElementById('breakEnd').value.trim();

  // Persist
  chrome.storage.local.set({ breakStart, breakEnd });

  setStatus(doSubmit ? 'Filling and submitting…' : 'Filling…', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('compass.talent.cognizant.com')) {
      setStatus('Open your Compass timesheet tab first, then click the extension.', 'error');
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: pageFn,
      args: [breakStart, breakEnd, doSubmit]
    });

    // Aggregate across frames
    let filled = 0, skipped = 0, submitted = false, debug = [];
    for (const r of results) {
      if (r && r.result) {
        filled += r.result.filled || 0;
        skipped += r.result.skipped || 0;
        if (r.result.submitted) submitted = true;
        if (r.result.debug) debug.push(r.result.debug);
      }
    }

    if (filled === 0 && skipped === 0) {
      setStatus('No timesheet rows found on this page. Make sure the timesheet is open.', 'error');
      return;
    }

    let msg = `Filled ${filled} row${filled === 1 ? '' : 's'}`;
    if (skipped > 0) msg += `, left ${skipped} untouched`;
    if (doSubmit) msg += submitted ? ' — submit clicked ✓' : ' — submit button not found';
    setStatus(msg, filled > 0 ? 'success' : 'info');
  } catch (e) {
    setStatus('Error: ' + e.message, 'error');
  }
}

function setStatus(text, kind) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = 'status show ' + (kind || '');
}

// ──────────────────────────────────────────────────────────────
// This function is serialised and runs inside the page (every frame).
// Keep it self-contained — no closures over popup variables.
// ──────────────────────────────────────────────────────────────
function pageFn(rawStart, rawEnd, doSubmit) {
  // --- helpers -------------------------------------------------
  function normalizeTime(t) {
    t = String(t || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!t) return '';

    // Plain hour: "12", "13", "9"
    if (/^\d{1,2}$/.test(t)) {
      const h = parseInt(t, 10);
      if (h === 0)   return '12:00:00AM';
      if (h < 12)    return `${h}:00:00AM`;
      if (h === 12)  return '12:00:00PM';
      if (h <= 23)   return `${h-12}:00:00PM`;
      return t;
    }

    // HH:MM[:SS][AM/PM]
    const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(AM|PM)?$/);
    if (!m) return t;
    let hh = parseInt(m[1], 10);
    const mm = m[2];
    const ss = m[3] || '00';
    let ampm = m[4];
    if (!ampm) {
      if (hh === 0)       { hh = 12; ampm = 'AM'; }
      else if (hh < 12)   { ampm = 'AM'; }
      else if (hh === 12) { ampm = 'PM'; }
      else                { hh -= 12; ampm = 'PM'; }
    }
    return `${hh}:${mm}:${ss}${ampm}`;
  }

  function nativeSet(input, value) {
    // PeopleSoft listens for input/change — go through the native setter
    // so any framework wrappers also see the update.
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (proto && proto.set) proto.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const TIME_RE = /^\s*\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)\s*$/i;
  const normStart = normalizeTime(rawStart);
  const normEnd   = normalizeTime(rawEnd);

  let filled = 0, skipped = 0, submitted = false;

  // --- find rows ------------------------------------------------
  // Strategy: scan every <tr>. In each row, take its text inputs in DOM order.
  // A valid timesheet row has exactly 4 consecutive "time" inputs:
  // [In, Break, In(lunch-back), Out]. The 1st and 4th must already be filled,
  // 2nd and 3rd must be empty. Anything else → skip.

  const trs = document.querySelectorAll('tr');

  trs.forEach((tr) => {
    const textInputs = Array.from(tr.querySelectorAll('input[type="text"]'))
      .filter(i => !i.disabled && !i.readOnly);
    if (textInputs.length < 4) return;

    // Locate the 4-input time block: find indices of inputs that currently
    // hold a time value (these will be the In and Out columns on filled rows).
    const timeIdxs = [];
    textInputs.forEach((inp, idx) => {
      if (TIME_RE.test(inp.value || '')) timeIdxs.push(idx);
    });

    // Need at least In and Out already filled.
    if (timeIdxs.length < 2) return;

    const firstIdx = timeIdxs[0];
    const lastIdx  = timeIdxs[timeIdxs.length - 1];

    // The block must span exactly 4 inputs (In, Break, In, Out)
    if (lastIdx - firstIdx !== 3) return;

    const inField     = textInputs[firstIdx];
    const breakField  = textInputs[firstIdx + 1];
    const lunchInField= textInputs[firstIdx + 2];
    const outField    = textInputs[firstIdx + 3];

    // Sanity: in/out must hold time-looking values, and middle pair must be empty
    if (!TIME_RE.test(inField.value) || !TIME_RE.test(outField.value)) { skipped++; return; }
    if ((breakField.value || '').trim() !== '' || (lunchInField.value || '').trim() !== '') {
      // Already filled (e.g. holiday row pre-populated or user already filled it) — leave alone
      skipped++;
      return;
    }

    nativeSet(breakField,   normStart);
    nativeSet(lunchInField, normEnd);
    // Blur to let PeopleSoft run its field-exit handler
    breakField.dispatchEvent(new Event('blur', { bubbles: true }));
    lunchInField.dispatchEvent(new Event('blur', { bubbles: true }));
    filled++;
  });

  // --- optional submit -----------------------------------------
  if (doSubmit && filled > 0) {
    // Give PeopleSoft a moment to process the field changes first
    setTimeout(() => {
      const candidates = Array.from(
        document.querySelectorAll('input[type="button"], input[type="submit"], button, a')
      );
      const submitEl = candidates.find(el => {
        const txt = (el.value || el.textContent || el.title || '').trim();
        return /^submit$/i.test(txt);
      });
      if (submitEl) submitEl.click();
    }, 600);
    submitted = true; // we attempted it; the deferred click runs after this returns
  }

  return { filled, skipped, submitted };
}
