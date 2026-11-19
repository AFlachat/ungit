// Copies text to the clipboard. Never throws: navigator.clipboard is missing on insecure origins
// (http other than localhost), where a hidden textarea and execCommand('copy') are used instead.
exports.copyText = async (text) => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* denied or unavailable: try the fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    /* reported below */
  }
  ungit.logger.warn('copy to clipboard failed');
  return false;
};
