import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSearchHtml } from '../registries/go';

// Trimmed from a real pkg.go.dev search results page.
const html = `
<div class="SearchSnippet" >
  <div class="SearchSnippet-headerContainer">
    <h2>
      <a href="/github.com/gin-gonic/gin" data-test-id="snippet-title" data-clicked-package="github.com/gin-gonic/gin">
        gin
        <span class="SearchSnippet-header-path">(github.com/gin-gonic/gin)</span>
      </a>
    </h2>
  </div>
  <p class="SearchSnippet-synopsis" data-test-id="snippet-synopsis">
    Package gin implements a HTTP web framework called gin &amp; friends.
  </p>
  <div class="SearchSnippet-infoLabel">
    <span class="go-textSubtle">
      <strong>v1.12.0</strong> published on <span data-test-id="snippet-published"><strong>Feb 28, 2026</strong></span>
    </span>
  </div>
</div>
<div class="SearchSnippet" >
  <div class="SearchSnippet-headerContainer">
    <h2><a href="/net/http" data-clicked-package="net/http">http <span class="SearchSnippet-header-path">(net/http)</span></a></h2>
  </div>
  <p class="SearchSnippet-synopsis">Package http provides HTTP client and server implementations.</p>
</div>
<div class="SearchSnippet" >
  <div class="SearchSnippet-headerContainer">
    <h2><a href="/github.com/appleboy/gin-jwt/v2" data-clicked-package="github.com/appleboy/gin-jwt/v2">gin-jwt</a></h2>
  </div>
  <div class="SearchSnippet-infoLabel"><strong>v2.10.3</strong> published on <strong>Mar 23, 2025</strong></div>
</div>
<div class="SearchSnippet" >
  <div class="SearchSnippet-headerContainer">
    <h2><a href="/github.com/hypothetical/untagged" data-clicked-package="github.com/hypothetical/untagged">untagged</a></h2>
  </div>
  <div class="SearchSnippet-infoLabel"><strong>v0.0.0-...-f3bf637</strong> published on <strong>Jan 2, 2026</strong></div>
</div>`;

test('parses third-party results and skips the standard library', () => {
  assert.deepEqual(parseSearchHtml(html), [
    {
      registry: 'go',
      name: 'github.com/gin-gonic/gin',
      version: 'v1.12.0',
      description: 'Package gin implements a HTTP web framework called gin & friends.',
    },
    { registry: 'go', name: 'github.com/appleboy/gin-jwt/v2', version: 'v2.10.3', description: '' },
    { registry: 'go', name: 'github.com/hypothetical/untagged', version: '', description: '' },
  ]);
});

test('returns nothing for a page without results', () => {
  assert.deepEqual(parseSearchHtml('<html><body>No results</body></html>'), []);
});
