(() => {
  'use strict';

  // ========== CONFIG ==========
  const DEFAULT_SRC_LANG = 'id';
  const LANG_NAMES = {
    id: 'Indonesia', en: 'English', 'zh-CN': '中文', ja: '日本語',
    ko: '한국어', es: 'Español', fr: 'Français', hi: 'Hindi', ar: 'العربية'
  };
  const MAX_BATCH_SIZE = 80; // Lebih konservatif
  const MAX_CONCURRENT = 2; // Reduced untuk safety
  const REQUEST_DELAY = 100; // Delay antar batch (ms)
  const MAX_REQUESTS_PER_MINUTE = 60; // Rate limit
  const USE_OFFICIAL_API = false;

  // ========== SELECTORS ==========
  const translateBtn = document.getElementById('translateBtn');
  const dropdown = document.getElementById('languageDropdown');
  const currentLangSpan = document.getElementById('currentLang');
  const languageOptions = document.querySelectorAll('.language-option');
  const loading = document.getElementById('loading');

  // ========== STATE ==========
  let currentLang = DEFAULT_SRC_LANG;
  let isTranslating = false;
  const cache = new Map();
  const originalText = new WeakMap();
  const originalAttr = new WeakMap();
  let abortController = null;
  
  // ========== RATE LIMITING ==========
  const requestLog = [];
  function canMakeRequest() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Remove old entries
    while (requestLog.length && requestLog[0] < oneMinuteAgo) {
      requestLog.shift();
    }
    
    return requestLog.length < MAX_REQUESTS_PER_MINUTE;
  }
  
  function logRequest() {
    requestLog.push(Date.now());
  }
  
  async function waitForRateLimit() {
    while (!canMakeRequest()) {
      console.log('Rate limit reached, waiting...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // ========== EXCLUSION ==========
  const EXCLUDE = new Set(['SCRIPT','STYLE','PRE','CODE','KBD','SAMP','VAR','MATH','SVG','CANVAS','IFRAME','NOSCRIPT']);
  
  const isExcluded = el => el && (EXCLUDE.has(el.tagName) || el.hidden || 
    el.getAttribute?.('translate') === 'no' || el.classList?.contains('notranslate'));
  
  const ancestorExcluded = el => el?.closest?.('script, style, pre, code, .notranslate') !== null;

  // ========== SAVE ORIGINAL ==========
  function saveOriginal(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.textContent?.trim() && n.parentElement && !ancestorExcluded(n.parentElement) ? 
        NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });

    let node;
    while (node = walker.nextNode()) {
      if (!originalText.has(node)) originalText.set(node, node.textContent);
    }

    root.querySelectorAll('[placeholder], [title], [alt]').forEach(el => {
      if (!isExcluded(el) && !ancestorExcluded(el) && !originalAttr.has(el)) {
        originalAttr.set(el, {
          placeholder: el.placeholder || null,
          title: el.title || null,
          alt: el.alt || null
        });
      }
    });
  }

  // ========== COLLECT ==========
  function collect(root = document.body) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.textContent?.trim() && n.parentElement && !ancestorExcluded(n.parentElement) ? 
        NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });

    let node;
    while (node = walker.nextNode()) nodes.push(node);

    const attrs = [];
    root.querySelectorAll('[placeholder], [title], [alt]').forEach(el => {
      if (!isExcluded(el) && !ancestorExcluded(el) && (el.placeholder || el.title || el.alt)) {
        attrs.push(el);
      }
    });

    return { nodes, attrs };
  }

  // ========== RESTORE ==========
  function restore() {
    const { nodes } = collect();
    nodes.forEach(n => {
      const orig = originalText.get(n);
      if (orig) n.textContent = orig;
    });

    document.querySelectorAll('[placeholder], [title], [alt]').forEach(el => {
      if (isExcluded(el) || ancestorExcluded(el)) return;
      const orig = originalAttr.get(el);
      if (orig) {
        if (orig.placeholder !== null) el.placeholder = orig.placeholder;
        if (orig.title !== null) el.title = orig.title;
        if (orig.alt !== null) el.alt = orig.alt;
      }
    });
  }

  // ========== FAST TRANSLATE - KEY OPTIMIZATION ==========
  // Gunakan pendekatan PARALLEL + LARGE BATCHES
  async function fastTranslate(texts, lang) {
    if (!texts?.length) return [];

    // Dedupe
    const unique = [...new Set(texts)];
    const map = texts.map(t => unique.indexOf(t));

    // Split by cache
    const cached = [];
    const needTrans = [];
    const needIdx = [];

    unique.forEach((text, i) => {
      const key = `${lang}::${text}`;
      if (cache.has(key)) {
        cached[i] = cache.get(key);
      } else {
        needTrans.push(text);
        needIdx.push(i);
      }
    });

    // Jika semua cached, return
    if (!needTrans.length) return map.map(i => cached[i]);

    // Batch into large chunks
    const batches = [];
    for (let i = 0; i < needTrans.length; i += MAX_BATCH_SIZE) {
      batches.push({
        texts: needTrans.slice(i, i + MAX_BATCH_SIZE),
        indices: needIdx.slice(i, i + MAX_BATCH_SIZE)
      });
    }

    console.log(`Translating ${needTrans.length} texts in ${batches.length} batches (parallel: ${MAX_CONCURRENT})`);

    // PARALLEL PROCESSING dengan rate limiting
    const processBatch = async (batch) => {
      await waitForRateLimit(); // Check rate limit first
      
      const delim = '\n___\n';
      const combined = batch.texts.join(delim);
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${DEFAULT_SRC_LANG}&tl=${lang}&dt=t&q=${encodeURIComponent(combined)}`;

      try {
        logRequest(); // Log sebelum request
        const res = await fetch(url, { signal: abortController?.signal });
        
        // Check for rate limit response
        if (res.status === 429) {
          console.warn('Rate limited by Google, waiting 2s...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          return processBatch(batch); // Retry
        }
        
        const data = await res.json();
        const trans = data[0].map(i => i[0]).join('');
        const parts = trans.split(delim);

        if (parts.length === batch.texts.length) {
          return parts;
        }
      } catch (e) {
        console.warn('Batch failed:', e);
        
        // Jika error network, tunggu sebentar
        if (e.name === 'TypeError') {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Fallback: individual dengan rate limit
      const results = [];
      for (const text of batch.texts) {
        await waitForRateLimit();
        try {
          const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${DEFAULT_SRC_LANG}&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
          logRequest();
          const r = await fetch(u, { signal: abortController?.signal });
          
          if (r.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          
          const d = await r.json();
          results.push(d[0].map(i => i[0]).join(''));
        } catch (e) {
          results.push(text);
        }
        
        // Small delay between individual requests
        if (batch.texts.length > 10) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      return results;
    };

    // Process batches dengan delay antar wave
    const results = [];
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
      const chunk = batches.slice(i, i + MAX_CONCURRENT);
      const chunkResults = await Promise.all(chunk.map(processBatch));
      results.push(...chunkResults);
      
      // Delay between waves untuk safety
      if (i + MAX_CONCURRENT < batches.length) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      }
    }

    // Merge results
    results.forEach((batchResult, batchIdx) => {
      batchResult.forEach((trans, i) => {
        const uniqueIdx = batches[batchIdx].indices[i];
        cached[uniqueIdx] = trans;
        cache.set(`${lang}::${unique[uniqueIdx]}`, trans);
      });
    });

    return map.map(i => cached[i]);
  }

  // ========== TRANSLATE SUBTREE ==========
  async function translateSubtree(root, lang) {
    if (!root || lang === DEFAULT_SRC_LANG) return;

    saveOriginal(root);
    const { nodes, attrs } = collect(root);

    if (!nodes.length && !attrs.length) return;

    try {
      // Translate all texts
      const allTexts = [];
      const textMap = [];
      
      nodes.forEach(n => {
        const orig = originalText.get(n) || n.textContent;
        allTexts.push(orig);
        textMap.push({ node: n, type: 'text' });
      });

      attrs.forEach(el => {
        const orig = originalAttr.get(el);
        if (orig?.placeholder) {
          allTexts.push(orig.placeholder);
          textMap.push({ node: el, type: 'placeholder' });
        }
        if (orig?.title) {
          allTexts.push(orig.title);
          textMap.push({ node: el, type: 'title' });
        }
        if (orig?.alt) {
          allTexts.push(orig.alt);
          textMap.push({ node: el, type: 'alt' });
        }
      });

      // Single translate call untuk SEMUA
      const translated = await fastTranslate(allTexts, lang);

      // Apply
      textMap.forEach((item, i) => {
        if (item.type === 'text') {
          item.node.textContent = translated[i];
        } else {
          item.node[item.type] = translated[i];
        }
      });

    } catch (err) {
      console.error('translateSubtree error:', err);
    }
  }

  // ========== MAIN TRANSLATE ==========
  async function translatePage(lang) {
    if (isTranslating || lang === currentLang) return;
    
    isTranslating = true;
    loading?.classList.add('active');
    dropdown?.classList.remove('active');

    if (abortController) abortController.abort();
    abortController = new AbortController();

    const start = performance.now();

    try {
      if (lang === DEFAULT_SRC_LANG) {
        restore();
      } else {
        const { nodes, attrs } = collect();

        // Collect ALL texts first
        const allTexts = [];
        const textMap = [];
        
        nodes.forEach(n => {
          const orig = originalText.get(n) || n.textContent;
          allTexts.push(orig);
          textMap.push({ node: n, type: 'text' });
        });

        attrs.forEach(el => {
          const orig = originalAttr.get(el);
          if (orig?.placeholder) {
            allTexts.push(orig.placeholder);
            textMap.push({ node: el, type: 'placeholder' });
          }
          if (orig?.title) {
            allTexts.push(orig.title);
            textMap.push({ node: el, type: 'title' });
          }
          if (orig?.alt) {
            allTexts.push(orig.alt);
            textMap.push({ node: el, type: 'alt' });
          }
        });

        console.log(`Total texts to translate: ${allTexts.length}`);

        // SINGLE BULK TRANSLATE untuk SEMUA
        const translated = await fastTranslate(allTexts, lang);

        // Apply results
        textMap.forEach((item, i) => {
          if (item.type === 'text') {
            item.node.textContent = translated[i];
          } else {
            item.node[item.type] = translated[i];
          }
        });
      }

      currentLang = lang;
      if (currentLangSpan) currentLangSpan.textContent = LANG_NAMES[lang] || lang;
      languageOptions.forEach(opt => opt.classList.toggle('active', opt.dataset.lang === lang));
      localStorage.setItem('selectedLanguage', lang);

      console.log(`Translation completed in ${((performance.now() - start) / 1000).toFixed(2)}s`);

      setTimeout(() => {
        window.sticIt?.();
        window.dispatchEvent(new Event('resize'));
      }, 50);

    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Translation failed:', err);
        alert('Terjadi kesalahan saat menerjemahkan.');
      }
    } finally {
      loading?.classList.remove('active');
      isTranslating = false;
    }
  }

  // ========== MUTATION OBSERVER ==========
  let mutTimer = null;
  const pending = new Set();

  const mo = new MutationObserver(muts => {
    muts.forEach(m => {
      if (m.type === 'childList' && m.addedNodes.length) {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            saveOriginal(n);
            if (currentLang !== DEFAULT_SRC_LANG) pending.add(n);
          }
        });
      }
    });

    clearTimeout(mutTimer);
    mutTimer = setTimeout(async () => {
      if (pending.size && currentLang !== DEFAULT_SRC_LANG) {
        const nodes = Array.from(pending);
        pending.clear();
        for (const n of nodes) await translateSubtree(n, currentLang);
      }
    }, 250);
  });

  // ========== UI ==========
  function bindUI() {
    translateBtn?.addEventListener('click', () => dropdown?.classList.toggle('active'));
    document.addEventListener('click', e => {
      if (!e.target.closest('.language-selector')) dropdown?.classList.remove('active');
    });
    languageOptions.forEach(opt => {
      opt.addEventListener('click', () => translatePage(opt.dataset.lang));
    });
    window.addEventListener('load', () => {
      const saved = localStorage.getItem('selectedLanguage');
      if (saved && saved !== DEFAULT_SRC_LANG) translatePage(saved);
    });
  }

  // ========== INIT ==========
  function init() {
    saveOriginal();
    mo.observe(document.body, { childList: true, subtree: true });
    bindUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__simpleTranslator = {
    translatePage,
    translateSubtree,
    restore,
    saveOriginal,
    currentLang: () => currentLang,
    cache
  };

})();

// ========== INFINITE SCROLL ==========
(function() {
  let t = null;
  function h(e, c) {
    clearTimeout(t);
    t = setTimeout(async () => {
      const lang = localStorage.getItem('selectedLanguage');
      if (!lang || lang === 'id' || !window.__simpleTranslator) return;
      
      let roots = Array.isArray(c) ? c.filter(n => n?.nodeType === 1) : 
                  c?.nodeType === 1 ? [c] : 
                  [document.querySelector('.last-loaded-items') || document.body];

      for (const r of roots) {
        window.__simpleTranslator.saveOriginal(r);
        await window.__simpleTranslator.translateSubtree(r, lang);
      }
    }, 300);
  }

  if (typeof infinite_scroll !== 'undefined' && infinite_scroll?.on) {
    infinite_scroll.on('load', h);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof infinite_scroll !== 'undefined' && infinite_scroll?.on) infinite_scroll.on('load', h);
    });
  }
})();

// ========== EXTERNAL WATCHER ==========
(function() {
  const SEL = ['.related-post-item', '#bookmark-list', '.bookmark-button', '.bookmark-button.bactive'];
  let t = null;

  function check() {
    const lang = localStorage.getItem('selectedLanguage');
    if (!lang || lang === 'id' || !window.__simpleTranslator) return;

    const els = [];
    SEL.forEach(s => document.querySelectorAll(s).forEach(el => {
      if (!el.dataset.translated) {
        el.dataset.translated = 'true';
        els.push(el);
      }
    }));

    if (els.length) {
      els.forEach(async el => {
        window.__simpleTranslator.saveOriginal(el);
        await window.__simpleTranslator.translateSubtree(el, lang);
      });
    }
  }

  let c = 0;
  const i = setInterval(() => {
    check();
    if (++c > 10) clearInterval(i);
  }, 500);

  const o = new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(check, 300);
  });
  o.observe(document.documentElement, { childList: true, subtree: true });
})();
