(function () {
  "use strict";

  const TIMESTAMP_KEY_SUFFIX = "_at";

  // Map of raw numeric string -> formatted annotation text
  const timestampMap = new Map();

  // ── Timestamp helpers ────────────────────────────────────────────────────

  function isLikelyMsEpoch(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return false;
    if (n < 1e12 || n > 1e14) return false;
    return !Number.isNaN(new Date(n).getTime());
  }

  const FMT_DATE = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  const FMT_TIME = { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true };

  function formatInZone(ms, timeZone) {
    const d = new Date(ms);
    const datePart = d.toLocaleDateString("en-US", { ...FMT_DATE, timeZone });
    const timePart = d.toLocaleTimeString("en-US", { ...FMT_TIME, timeZone });
    return `${datePart} at ${timePart}`;
  }

  function formatAnnotation(ms) {
    return {
      utc: `⏱️ ${formatInZone(ms, "UTC")}`,
      bdt: `🇧🇩 ${formatInZone(ms, "Asia/Dhaka")}`,
    };
  }

  function collectTimestamps(obj) {
    if (Array.isArray(obj)) {
      obj.forEach((item) => collectTimestamps(item));
    } else if (obj !== null && typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (
          typeof k === "string" &&
          k.endsWith(TIMESTAMP_KEY_SUFFIX) &&
          isLikelyMsEpoch(v)
        ) {
          timestampMap.set(String(v), formatAnnotation(v));
        } else {
          collectTimestamps(v);
        }
      }
    }
  }

  // ── DOM injection ────────────────────────────────────────────────────────

  function makeAnnotationSpan({ utc, bdt }) {
    const wrapper = document.createElement("span");
    wrapper.className = "midb-ts-comment";

    const utcSpan = document.createElement("span");
    utcSpan.className = "midb-ts-utc";
    utcSpan.textContent = utc;

    const sep = document.createTextNode("  ");

    const bdtSpan = document.createElement("span");
    bdtSpan.className = "midb-ts-bdt";
    bdtSpan.textContent = bdt;

    wrapper.appendChild(utcSpan);
    wrapper.appendChild(sep);
    wrapper.appendChild(bdtSpan);
    return wrapper;
  }

  function injectAnnotations() {
    // Skip if we've already annotated this render
    if (document.querySelector(".midb-ts-comment")) return;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Skip our own injected spans
          if (
            node.parentElement &&
            node.parentElement.classList.contains("midb-ts-comment")
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const hits = [];
    let node;
    while ((node = walker.nextNode())) {
      const raw = node.textContent.trim();
      if (timestampMap.has(raw)) {
        hits.push({ node, annotation: timestampMap.get(raw) });
      }
    }

    for (const { node, annotation } of hits) {
      const parent = node.parentNode;
      if (!parent) continue;
      const span = makeAnnotationSpan(annotation);
      // Insert immediately after the text node
      if (node.nextSibling) {
        parent.insertBefore(span, node.nextSibling);
      } else {
        parent.appendChild(span);
      }
    }
  }

  // ── Raw JSON capture ─────────────────────────────────────────────────────

  function getRawText() {
    const pre = document.querySelector("body > pre");
    if (
      pre &&
      pre.childNodes.length === 1 &&
      pre.firstChild &&
      pre.firstChild.nodeType === Node.TEXT_NODE
    ) {
      return pre.textContent || "";
    }
    return (document.body?.innerText || document.body?.textContent || "").trim();
  }

  function tryParseJson(text) {
    const t = (text || "").replace(/^\uFEFF/, "").trim();
    if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────

  function setup(rawText) {
    const data = tryParseJson(rawText);
    if (!data) return;

    collectTimestamps(data);
    if (timestampMap.size === 0) return;

    // Watch for JSON Viewer Pro (or any formatter) to finish rendering,
    // then inject our annotations. Debounce so we only run once after
    // the DOM settles.
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        injectAnnotations();
      }, 400);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Also try immediately in case the formatter already ran
    injectAnnotations();
  }

  function main() {
    const raw = getRawText();
    if (raw) {
      setup(raw);
      return;
    }

    // Body not ready yet — wait for it then capture before any formatter runs
    const bodyObserver = new MutationObserver(() => {
      const pre = document.querySelector("body > pre");
      if (pre) {
        bodyObserver.disconnect();
        setup(pre.textContent || "");
      }
    });
    bodyObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Run as early as possible so we can read the raw <pre> text
  if (document.readyState === "loading") {
    // document_start: DOM not parsed yet
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
