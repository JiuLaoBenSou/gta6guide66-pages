(() => {
  const search = document.getElementById('guide-query');
  const entries = JSON.parse(document.getElementById('guide-search-data').textContent);
  const results = document.getElementById('guide-search-results');
  const status = document.getElementById('guide-search-status');
  const form = search.form;
  const lookup = form.closest('.guide-lookup');
  const { resultLimit, resultsLabel, noMatches } = lookup.dataset;
  const limit = Number(resultLimit);
  const onDirectory = !lookup.classList.contains('hero-lookup');
  const isTurkish = /^tr(?:-|$)/i.test(document.documentElement.lang);
  const commonWords = new Set(['a', 'an', 'and', 'can', 'do', 'does', 'for', 'how', 'i', 'in', 'is', 'my', 'on', 'the', 'to', 'what', 'where']);

  function normalize(text) {
    const lower = text.toLowerCase();
    const searchable = isTurkish ? lower.replaceAll('ı', 'i') : lower;
    return searchable.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  const indexed = entries.map(entry => ({
    ...entry,
    name: normalize(entry.title),
    text: normalize(`${entry.title} ${entry.description} ${entry.keywords ?? ''}`)
  }));

  function updateResults() {
    const query = normalize(search.value);
    results.replaceChildren();
    if (!query) {
      status.textContent = '';
      return;
    }

    const words = query.replace(/\bgta (6|vi)\b/g, '').split(' ').filter(word => word && (resultsLabel || !commonWords.has(word)));
    if (words.length === 0) {
      status.textContent = noMatches ?? 'Enter a mission, item, location or error.';
      return;
    }
    const phrase = words.join(' ');
    const ranked = indexed
      .filter(entry => words.every(word => entry.text.includes(word)))
      .map(entry => {
        const exactTitle = entry.name === query ? 16 : 0;
        const titleMatches = words.filter(word => entry.name.includes(word)).length;
        const phraseMatch = isTurkish && words.length > 1 && entry.text.includes(phrase) ? 2 : 0;
        return { entry, rank: exactTitle + titleMatches + phraseMatch };
      })
      .sort((left, right) => right.rank - left.rank);
    const sectionPages = new Set(ranked.filter(({ entry }) => entry.href.includes('#')).map(({ entry }) => entry.href.split('#')[0]));
    const matches = ranked.filter(({ entry }) => !sectionPages.has(entry.href));

    if (!matches.length) {
      status.textContent = noMatches ?? 'No guides match. Try the mission name, item, or error code.';
    } else if (resultsLabel) {
      status.textContent = `${resultsLabel} · ${matches.length}`;
    } else {
      status.textContent = `${matches.length} matching ${matches.length === 1 ? 'guide' : 'guides'}${matches.length > limit ? ` · showing ${limit}` : ''}`;
    }

    for (const { entry } of matches.slice(0, limit)) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      const summary = document.createElement('span');
      link.href = entry.href;
      title.textContent = entry.title;
      summary.className = 'guide-summary';
      summary.textContent = entry.description;
      copy.append(title, summary);
      link.append(copy);
      item.append(link);
      results.append(item);
    }
  }

  form.hidden = false;
  form.addEventListener('submit', event => {
    if (!onDirectory) return;
    event.preventDefault();
    const url = new URL(location.href);
    if (search.value.trim()) url.searchParams.set('q', search.value.trim());
    else url.searchParams.delete('q');
    url.hash = 'find-an-answer';
    history.replaceState(null, '', url);
    updateResults();
  });
  search.addEventListener('input', updateResults);
  search.value = new URLSearchParams(location.search).get('q')?.slice(0, search.maxLength) ?? search.value;
  updateResults();
})();
