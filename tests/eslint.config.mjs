// ESLint (global installiert, ohne Abhängigkeiten im Repo):  eslint -c tests/eslint.config.mjs js sw.js tests
const browser = Object.fromEntries(['window', 'document', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'indexedDB', 'IDBKeyRange', 'crypto', 'URL', 'Blob', 'File', 'FileReader', 'fetch', 'AbortController', 'Image', 'createImageBitmap', 'Intl',
  'location', 'confirm', 'Event', 'atob', 'btoa', 'caches', 'self', 'Response', 'Request', 'sessionStorage', 'localStorage', 'requestAnimationFrame',
  'cancelAnimationFrame', 'matchMedia', 'CSS', 'CSSTransition', 'CSSAnimation', 'getComputedStyle', 'IntersectionObserver', 'ResizeObserver',
  'MutationObserver', 'performance', 'DOMRect', 'DOMException', 'Element', 'HTMLElement', 'TextEncoder', 'TextDecoder', 'OffscreenCanvas',
  'ImageData', 'AudioContext', 'webkitAudioContext', 'structuredClone', 'queueMicrotask', 'history', 'screen', 'getSelection', 'alert',
  'google', 'DecompressionStream', 'CompressionStream', 'Headers', 'FormData', 'URLSearchParams', 'WeakRef', 'PointerEvent', 'TouchEvent',
  'KeyboardEvent', 'CustomEvent', 'Node', 'NodeFilter', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'visualViewport', 'scrollTo',
  'getComputedStyle', 'ClipboardItem', 'Notification', 'BroadcastChannel', 'MessageChannel', 'Worker', 'importScripts', 'clients',
  'ServiceWorkerRegistration', 'DOMParser', 'XMLSerializer', 'SVGElement', 'HTMLCanvasElement', 'HTMLImageElement', 'VideoFrame'].map((g) => [g, 'readonly']));
const node = Object.fromEntries(['require', 'module', 'process', 'Buffer', '__dirname', 'console', 'setTimeout', 'clearTimeout', 'URL'].map((g) => [g, 'readonly']));
const rules = { 'no-unused-vars': ['error', { caughtErrors: 'none' }], 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-redeclare': 'error', 'no-import-assign': 'error' };

export default [
  { files: ['js/**/*.js', 'sw.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser }, rules },
  { files: ['sw.js'], languageOptions: { sourceType: 'script' } },
  // Die Tests laufen in Node; was sie im Browser auswerten (page.evaluate), sieht ESLint nur als Text.
  { files: ['tests/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...node, ...browser } }, rules },
];
