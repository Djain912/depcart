import { getJson } from './http';
import type { Registry } from './types';
import { perPackage, specs, versionList } from './util';

const API = 'https://rubygems.org/api/v1';

/** RubyGems treats any version containing a letter (1.0.0.beta1, 2.0.rc) as a pre-release. */
const isPrerelease = (v: string) => /[a-zA-Z]/.test(v);

export const rubygemsRegistry: Registry = {
  id: 'rubygems',
  label: 'Ruby',
  title: 'Ruby gems from RubyGems.org',
  example: 'rails, rspec-core',
  ecosystems: { registry: 'rubygems.org', ecosystem: 'rubygems', sort: 'downloads' },
  projectMarkers: [{ file: 'Gemfile' }, { file: '*.gemspec' }],
  namePattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  versionPattern: /^\d+(?:\.[0-9A-Za-z]+)*$/,
  tools: [
    { id: 'gem', label: 'gem install', kind: 'command', build: (p) => `gem install ${specs(p, ':')}` },
    {
      id: 'bundler',
      label: 'bundle add',
      kind: 'command',
      markers: [{ file: 'Gemfile' }, { file: 'Gemfile.lock' }],
      // bundle add applies one --version to every gem it's given, so each gem gets its own line.
      build: (p) => perPackage(p, (x) => `bundle add ${x.name} --version ${x.version}`),
    },
  ],

  pageUrl: (name) => `https://rubygems.org/gems/${name}`,

  async search(query, limit, signal) {
    const gems = await getJson<{ name: string; version: string; info?: string }[]>(
      `${API}/search.json?query=${encodeURIComponent(query)}`,
      signal,
    );
    return gems.slice(0, limit).map((g) => ({ registry: 'rubygems', name: g.name, version: g.version, description: g.info ?? '' }));
  },

  async versions(name, signal) {
    // Already newest first; platform-specific builds repeat a number, which versionList de-duplicates.
    const list = await getJson<{ number: string }[]>(`${API}/versions/${encodeURIComponent(name)}.json`, signal);
    return versionList(
      list.map((v) => v.number),
      undefined,
      isPrerelease,
    );
  },
};
