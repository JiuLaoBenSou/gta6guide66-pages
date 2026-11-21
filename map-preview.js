const map = document.querySelector('[data-map-preview]');
const viewport = map.querySelector('.map-viewport');
const image = map.querySelector('.map-image');
const raster = image.querySelector('img');
const detailLayer = image.querySelector('.map-detail-tiles');
const markers = image.querySelector('.map-markers');
const list = map.querySelector('.map-places');
const query = map.querySelector('#map-query');
const status = map.querySelector('.map-status');
const more = map.querySelector('.map-more');
const details = map.querySelector('.map-selected');
const complete = details.querySelector('[data-map-complete]');
const note = details.querySelector('textarea');
const share = details.querySelector('[data-map-share]');
const shareUrl = details.querySelector('.map-share-url');
const visitFilter = map.querySelector('[data-map-visit]');
const countyFilter = map.querySelector('[data-map-county]');
const borderToggle = map.querySelector('[data-map-borders]');
const boundaries = map.querySelector('.map-boundaries');
const presetSelect = map.querySelector('[data-map-preset]');
const presetName = map.querySelector('[data-map-filter-name]');
const removePreset = map.querySelector('[data-map-remove-filter]');
const progress = map.querySelector('.map-progress');
const filterPanel = map.querySelector('.map-filter-panel');
const zoomOut = map.querySelector('[data-map-zoom="-1"]');
const zoomIn = map.querySelector('[data-map-zoom="1"]');
const zoomLabel = map.querySelector('.map-zoom-level');
const expand = map.querySelector('[data-map-expand]');
const filters = [...map.querySelectorAll('[data-category]')];
const categories = Object.fromEntries(filters.map(button => [button.dataset.category, button.dataset.label]));
const spriteColumns = Number(map.dataset.spriteColumns);
const spriteRows = Number(map.dataset.spriteRows);
const smallScreen = matchMedia('(max-width: 48rem)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const zoomLimit = 24;
const pageSize = 40;
const atlasWidth = Number(raster.getAttribute('width'));
const atlasHeight = Number(raster.getAttribute('height'));
const detailLevels = [
  { density: 2, size: 384, minScale: .85 },
  { density: 8, size: 128, minScale: 2.7 }
];
const detailTiles = new Map();
let visibleDetailTiles = [];
let visibleDetailIds = new Set();
let loadingDetailTiles = 0;
const pointers = new Map();
const activeTypes = new Set(Object.keys(categories));
const storageKey = 'gta6-guides:leonida-mapgenie:v1';

let stored;
try { stored = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Storage can be blocked. */ }
const visited = new Set(Array.isArray(stored?.visited) ? stored.visited : []);
const notes = new Map(Object.entries(stored?.notes ?? {}).filter(([, value]) => typeof value === 'string'));
const presets = new Map(Object.entries(stored?.presets ?? {}).filter(([, value]) => Array.isArray(value?.types)));

let zoom = 1;
let zoomTarget = 1;
let fit = 1;
let left = 0;
let top = 0;
let frameWidth = 0;
let frameHeight = 0;
let animation = 0;
let poseFrame = 0;
let markerTimer = 0;
let markerSignature = '';
let dragging = false;
let skipClick = false;
let velocity = null;
let records = [];
let results = [];
let byId = new Map();
let selected = null;
let shown = pageSize;

const width = () => atlasWidth * fit * zoom;
const height = () => atlasHeight * fit * zoom;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}|['’]/gu, '').toLowerCase().trim();

function saveProgress() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ visited: [...visited], notes: Object.fromEntries(notes), presets: Object.fromEntries(presets) }));
  } catch { /* The map remains usable without persistent storage. */ }
}

function keepInsideMap() {
  const limitX = frameWidth - width();
  const limitY = frameHeight - height();
  left = clamp(left, Math.min(0, limitX), Math.max(0, limitX));
  top = clamp(top, Math.min(0, limitY), Math.max(0, limitY));
}

function positionDetails() {
  if (!selected || smallScreen.matches) return;
  const pointX = left + selected.x * width();
  const pointY = top + selected.y * height();
  const half = Math.min(170, frameWidth / 2);
  details.style.setProperty('--point-x', clamp(pointX, half, frameWidth - half) + 'px');
  details.style.setProperty('--point-y', clamp(pointY, 12, frameHeight - 12) + 'px');
  details.toggleAttribute('data-below', pointY < Math.min(frameHeight * .55, 330));
}

function drawPose() {
  image.style.width = width() + 'px';
  image.style.height = height() + 'px';
  image.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
  zoomOut.disabled = zoom <= 1;
  zoomIn.disabled = zoom >= zoomLimit;
  zoomLabel.value = zoom.toFixed(zoom < 10 && zoom % 1 ? 1 : 0) + '×';
  positionDetails();
}

function queuePose() {
  if (poseFrame) return;
  poseFrame = requestAnimationFrame(() => {
    poseFrame = 0;
    drawPose();
  });
}

function scheduleMarkers() {
  if (markerTimer) return;
  markerTimer = setTimeout(() => {
    markerTimer = 0;
    drawMarkers();
  }, 90);
}

function stopMotion() {
  cancelAnimationFrame(animation);
  animation = 0;
  zoomTarget = zoom;
}

function resize() {
  const centerX = frameWidth ? (frameWidth / 2 - left) / width() : .5;
  const centerY = frameHeight ? (frameHeight / 2 - top) / height() : .5;
  frameWidth = viewport.clientWidth;
  frameHeight = viewport.clientHeight;
  if (!frameWidth || !frameHeight) return;
  fit = Math.min(frameWidth / atlasWidth, frameHeight / atlasHeight);
  left = frameWidth / 2 - centerX * width();
  top = frameHeight / 2 - centerY * height();
  keepInsideMap();
  drawPose();
  drawMarkers();
}

function setZoom(nextZoom, x, y) {
  const ratio = nextZoom / zoom;
  left = x - (x - left) * ratio;
  top = y - (y - top) * ratio;
  zoom = nextZoom;
  keepInsideMap();
}

function animateZoom(nextZoom, x = frameWidth / 2, y = frameHeight / 2) {
  stopMotion();
  zoomTarget = clamp(nextZoom, 1, zoomLimit);
  if (zoom === zoomTarget) return;
  const start = zoom;
  const anchorX = (x - left) / width();
  const anchorY = (y - top) / height();
  if (reducedMotion.matches) {
    setZoom(zoomTarget, x, y);
    drawPose();
    drawMarkers();
    return;
  }
  const began = performance.now();
  const frame = time => {
    const fraction = clamp((time - began) / 165, 0, 1);
    const ease = 1 - (1 - fraction) ** 3;
    zoom = fraction === 1 ? zoomTarget : start * (zoomTarget / start) ** ease;
    left = x - anchorX * width();
    top = y - anchorY * height();
    keepInsideMap();
    drawPose();
    if (fraction < 1) animation = requestAnimationFrame(frame);
    else {
      animation = 0;
      drawMarkers();
    }
  };
  animation = requestAnimationFrame(frame);
}

function centerOn(x, y, nextZoom) {
  stopMotion();
  zoom = zoomTarget = clamp(nextZoom, 1, zoomLimit);
  left = frameWidth / 2 - x * width();
  top = frameHeight / 2 - y * height();
  keepInsideMap();
  drawPose();
  drawMarkers();
}

function markerIcon(slot) {
  const icon = document.createElement('span');
  icon.className = 'map-marker-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.style.setProperty('--icon-x', slot % spriteColumns * 100 / (spriteColumns - 1) + '%');
  icon.style.setProperty('--icon-y', Math.floor(slot / spriteColumns) * 100 / (spriteRows - 1) + '%');
  return icon;
}

function placeControl(record, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.place = record.id;
  button.dataset.kind = record.category;
  button.setAttribute('aria-pressed', String(selected === record));
  button.toggleAttribute('data-visited', visited.has(record.id));
  button.append(markerIcon(record.icon));
  return button;
}

function trimDetailCache() {
  for (const [id, tile] of detailTiles) {
    if (visibleDetailIds.has(id)) continue;
    tile.remove();
    if (tile.complete && (tile.hidden || detailTiles.size > 32)) detailTiles.delete(id);
  }
}

function loadVisibleDetailTiles() {
  for (const { id, x, y, size, density } of visibleDetailTiles) {
    const cached = detailTiles.get(id);
    if (cached) {
      if (!cached.isConnected) detailLayer.append(cached);
      continue;
    }
    if (loadingDetailTiles >= 4) continue;
    const tile = document.createElement('img');
    tile.alt = '';
    tile.draggable = false;
    tile.decoding = 'async';
    tile.dataset.density = density;
    tile.style.zIndex = density;
    tile.style.left = x / atlasWidth * 100 + '%';
    tile.style.top = y / atlasHeight * 100 + '%';
    tile.style.width = Math.min(size, atlasWidth - x) / atlasWidth * 100 + '%';
    tile.style.height = Math.min(size, atlasHeight - y) / atlasHeight * 100 + '%';
    const settle = event => {
      loadingDetailTiles -= 1;
      tile.hidden = event.type === 'error';
      tile.toggleAttribute('data-loaded', !tile.hidden);
      trimDetailCache();
      loadVisibleDetailTiles();
    };
    tile.addEventListener('load', settle, { once: true });
    tile.addEventListener('error', settle, { once: true });
    loadingDetailTiles += 1;
    detailTiles.set(id, tile);
    detailLayer.append(tile);
    tile.src = detailLayer.dataset.src + id + '.webp';
  }
}

function drawDetailTiles() {
  const scale = fit * zoom;
  const screenDensity = scale * Math.min(devicePixelRatio, 1.5);
  const visible = [];
  for (const { density, size, minScale } of detailLevels) {
    if (screenDensity < minScale) continue;
    const screenTile = size * scale;
    const firstCol = Math.max(0, Math.floor(-left / screenTile));
    const firstRow = Math.max(0, Math.floor(-top / screenTile));
    const lastCol = Math.min(Math.ceil(atlasWidth / size) - 1, Math.floor((frameWidth - left) / screenTile));
    const lastRow = Math.min(Math.ceil(atlasHeight / size) - 1, Math.floor((frameHeight - top) / screenTile));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        const centerX = left + (col + .5) * screenTile - frameWidth / 2;
        const centerY = top + (row + .5) * screenTile - frameHeight / 2;
        const id = density + '-' + col + '-' + row;
        visible.push({ id, density, size, x: col * size, y: row * size, distance: Math.hypot(centerX, centerY) });
      }
    }
  }
  visibleDetailTiles = visible.sort((a, b) => a.distance - b.distance);
  visibleDetailIds = new Set(visible.map(tile => tile.id));
  trimDetailCache();
  loadVisibleDetailTiles();
}

function drawMarkers() {
  drawDetailTiles();
  const groups = new Map();
  const cell = 46;
  const scaledWidth = width();
  const scaledHeight = height();
  for (const record of results) {
    const screenX = left + record.x * scaledWidth;
    const screenY = top + record.y * scaledHeight;
    if (screenX < -100 || screenX > frameWidth + 100 || screenY < -100 || screenY > frameHeight + 100) continue;
    const grouped = zoom < 7 && selected !== record;
    const key = grouped ? Math.floor(record.x * scaledWidth / cell) + ',' + Math.floor(record.y * scaledHeight / cell) : record.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const signature = [...groups.values()].map(group => group.map(record => record.id + (visited.has(record.id) ? 'v' : '')).join(',')).join('|') + ':' + (selected?.id ?? '');
  if (signature === markerSignature) return;
  markerSignature = signature;
  const focused = markers.contains(document.activeElement) ? document.activeElement : null;
  const nodes = document.createDocumentFragment();
  let focusedReplacement;
  for (const group of groups.values()) {
    const [record] = group;
    let { x, y } = record;
    let button;
    if (group.length === 1) {
      button = placeControl(record, 'map-pin');
      const label = [record.name, record.area].filter(Boolean).join(', ');
      button.title = label;
      button.setAttribute('aria-label', label);
      if (focused?.dataset.place === record.id) focusedReplacement = button;
    } else {
      x = group.reduce((sum, place) => sum + place.x, 0) / group.length;
      y = group.reduce((sum, place) => sum + place.y, 0) / group.length;
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-cluster';
      button.dataset.cluster = x + ',' + y;
      button.textContent = group.length;
      button.setAttribute('aria-label', 'Zoom to ' + group.length + ' places');
      if (focused?.dataset.cluster === button.dataset.cluster) focusedReplacement = button;
    }
    button.style.left = x * 100 + '%';
    button.style.top = y * 100 + '%';
    nodes.append(button);
  }
  markers.replaceChildren(nodes);
  if (focused) (focusedReplacement ?? viewport).focus({ preventScroll: true });
}

function drawList(start = 0) {
  const rows = document.createDocumentFragment();
  for (const record of results.slice(start, shown)) {
    const row = document.createElement('li');
    const button = placeControl(record, 'map-place');
    const label = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = record.name;
    label.append(name);
    if (record.area) {
      const area = document.createElement('small');
      area.textContent = record.area;
      label.append(area);
    }
    button.append(label);
    row.append(button);
    rows.append(row);
  }
  if (!start) list.replaceChildren();
  list.append(rows);
  more.hidden = shown >= results.length;
}

function placeUrl(record) {
  const url = new URL(location.href);
  if (record) url.searchParams.set('place', record.id);
  else url.searchParams.delete('place');
  return url;
}

function showPlace(record) {
  selected = record;
  details.hidden = !record;
  history.replaceState(history.state, '', placeUrl(record));
  for (const button of list.querySelectorAll('[data-place]')) {
    button.setAttribute('aria-pressed', String(record?.id === button.dataset.place));
  }
  if (!record) return;
  details.querySelector('h2').textContent = record.name;
  details.querySelector('.map-detail-icon').replaceChildren(markerIcon(record.icon));
  details.querySelector('.map-area').textContent = record.area;
  details.querySelector('.map-place-category').textContent = categories[record.category];
  details.querySelector('.map-uncertain').hidden = !record.unconfirmed;
  details.querySelector('.map-notes').open = false;
  complete.checked = visited.has(record.id);
  note.value = notes.get(record.id) ?? '';
  share.textContent = 'Copy link';
  shareUrl.hidden = true;
  positionDetails();
}

function updateResults({ keepList = false } = {}) {
  const terms = normalize(query.value).split(/\s+/).filter(Boolean);
  const county = Number(countyFilter.value);
  results = records.filter(record => activeTypes.has(record.category)
    && (!county || record.county === county)
    && (visitFilter.value === 'all' || visited.has(record.id) === (visitFilter.value === 'visited'))
    && terms.every(term => record.search.includes(term)));
  if (terms.length) {
    const rank = record => terms.every(term => record.searchName.includes(term)) ? 0 : 1;
    results.sort((a, b) => rank(a) - rank(b));
  }
  if (selected && !results.includes(selected)) showPlace(null);
  if (!keepList) shown = pageSize;
  status.textContent = results.length === 0 ? 'No matching places' : results.length.toLocaleString('en-US') + (results.length === 1 ? ' place' : ' places');
  progress.textContent = visited.size + ' / ' + records.length + ' visited';
  drawList();
  drawMarkers();
  if (!keepList) map.querySelector('.map-results').scrollTop = 0;
}

function selectRecord(record, fromList) {
  showPlace(record);
  if (fromList) {
    centerOn(record.x, record.y, Math.max(zoom, 3));
    if (smallScreen.matches) viewport.scrollIntoView({ block: 'center' });
  } else {
    drawMarkers();
    viewport.focus({ preventScroll: true });
  }
}

function updateFilters(buttons, enabled) {
  for (const button of buttons) {
    if (enabled) activeTypes.add(button.dataset.category);
    else activeTypes.delete(button.dataset.category);
  }
  drawFilters();
  updateResults();
}

function drawFilters() {
  for (const button of filters) button.setAttribute('aria-pressed', String(activeTypes.has(button.dataset.category)));
  for (const group of map.querySelectorAll('[data-map-filter-group]')) {
    const options = [...group.querySelectorAll('[data-category]:not([hidden])')];
    const toggle = group.querySelector('[data-map-group]');
    const any = options.some(button => activeTypes.has(button.dataset.category));
    toggle.textContent = any ? 'Hide group' : 'Show group';
    toggle.setAttribute('aria-label', (any ? 'Hide ' : 'Show ') + group.querySelector('h2').textContent);
    group.querySelector('[data-group-count]').textContent = options.reduce((sum, option) =>
      sum + (activeTypes.has(option.dataset.category) ? Number(option.querySelector('[data-count]').textContent) : 0), 0);
  }
}

function drawPresets(selectedName = '') {
  presetSelect.options.length = 1;
  for (const name of presets.keys()) presetSelect.add(new Option(name, name));
  presetSelect.value = selectedName;
  removePreset.disabled = !selectedName;
}

query.addEventListener('input', () => updateResults());
query.addEventListener('keydown', event => {
  if (event.key === 'Enter' && results.length) selectRecord(results[0], true);
});
visitFilter.addEventListener('change', () => updateResults());
countyFilter.addEventListener('change', () => updateResults());
borderToggle.addEventListener('change', () => {
  if (borderToggle.checked && !boundaries.hasAttribute('src')) boundaries.src = boundaries.dataset.src;
  boundaries.hidden = !borderToggle.checked;
});
presetSelect.addEventListener('change', () => {
  const preset = presets.get(presetSelect.value);
  removePreset.disabled = !preset;
  if (!preset) return;
  activeTypes.clear();
  for (const type of preset.types) if (Object.hasOwn(categories, type)) activeTypes.add(type);
  countyFilter.value = preset.county;
  visitFilter.value = preset.visit;
  drawFilters();
  updateResults();
});
presetName.addEventListener('submit', event => {
  event.preventDefault();
  const input = presetName.querySelector('input');
  const name = input.value.trim();
  if (!name) return;
  presets.set(name, { types: [...activeTypes], county: countyFilter.value, visit: visitFilter.value });
  saveProgress();
  drawPresets(name);
  presetName.hidden = true;
  presetName.reset();
  presetSelect.focus();
});
complete.addEventListener('change', () => {
  if (!selected) return;
  if (complete.checked) visited.add(selected.id);
  else visited.delete(selected.id);
  saveProgress();
  updateResults({ keepList: true });
  if (details.hidden) viewport.focus({ preventScroll: true });
});
note.addEventListener('input', () => {
  if (!selected) return;
  if (note.value.trim()) notes.set(selected.id, note.value);
  else notes.delete(selected.id);
  saveProgress();
});

map.addEventListener('click', async event => {
  if (skipClick && event.detail && viewport.contains(event.target)) return;
  const button = event.target.closest('button');
  if (!button) {
    if (selected && viewport.contains(event.target)) {
      showPlace(null);
      drawMarkers();
    }
    return;
  }
  if (button.dataset.category) {
    updateFilters([button], !activeTypes.has(button.dataset.category));
  } else if (button.hasAttribute('data-map-group')) {
    const options = [...button.closest('[data-map-filter-group]').querySelectorAll('[data-category]:not([hidden])')];
    updateFilters(options, !options.some(option => activeTypes.has(option.dataset.category)));
  } else if (button.dataset.mapFilters) {
    updateFilters(filters.filter(option => !option.hidden), button.dataset.mapFilters === 'show');
  } else if (button.hasAttribute('data-map-save-filter')) {
    presetName.hidden = !presetName.hidden;
    if (!presetName.hidden) presetName.querySelector('input').focus();
  } else if (button === removePreset) {
    presets.delete(presetSelect.value);
    saveProgress();
    drawPresets();
    presetSelect.focus();
  } else if (button.dataset.place) {
    selectRecord(byId.get(button.dataset.place), list.contains(button));
  } else if (button.dataset.cluster) {
    const [x, y] = button.dataset.cluster.split(',').map(Number);
    centerOn(x, y, zoom * 1.9);
    viewport.focus({ preventScroll: true });
  } else if (button.dataset.mapZoom) {
    animateZoom(zoomTarget * 1.55 ** Number(button.dataset.mapZoom));
  } else if (button.hasAttribute('data-map-reset')) {
    centerOn(.5, .5, 1);
  } else if (button === expand) {
    const expanded = map.classList.toggle('map-expanded');
    expand.setAttribute('aria-pressed', String(expanded));
    expand.setAttribute('aria-label', expanded ? 'Exit expanded map' : 'Expand map');
    document.body.classList.toggle('map-expanded-body', expanded);
  } else if (button.hasAttribute('data-map-close')) {
    showPlace(null);
    drawMarkers();
    viewport.focus({ preventScroll: true });
  } else if (button === share && selected) {
    const record = selected;
    const url = placeUrl(record).href;
    try {
      await navigator.clipboard.writeText(url);
      if (selected === record) share.textContent = 'Copied';
    } catch {
      if (selected !== record) return;
      shareUrl.value = url;
      shareUrl.hidden = false;
      shareUrl.select();
    }
  } else if (button === more) {
    const start = shown;
    shown += pageSize;
    drawList(start);
    list.children[start]?.querySelector('button').focus();
  }
});

function pointerPoint(event) {
  const box = viewport.getBoundingClientRect();
  return [event.clientX - box.left, event.clientY - box.top];
}

viewport.addEventListener('wheel', event => {
  event.preventDefault();
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? frameHeight : 1;
  const factor = Math.exp(-clamp(event.deltaY * unit, -400, 400) * .0028);
  animateZoom(zoomTarget * factor, ...pointerPoint(event));
}, { passive: false });

viewport.addEventListener('dblclick', event => {
  if (!event.target.closest('button')) animateZoom(zoomTarget * (event.shiftKey ? .5 : 2), ...pointerPoint(event));
});

map.addEventListener('keydown', event => {
  if (event.key === 'Escape' && map.classList.contains('map-expanded')) {
    expand.click();
    expand.focus({ preventScroll: true });
  } else if (event.key === 'Escape' && selected) {
    details.querySelector('[data-map-close]').click();
  } else if (event.target === viewport) {
    const motion = { ArrowLeft: [55, 0], ArrowRight: [-55, 0], ArrowUp: [0, 55], ArrowDown: [0, -55] }[event.key];
    if (motion) {
      stopMotion();
      left += motion[0];
      top += motion[1];
      keepInsideMap();
      drawPose();
      scheduleMarkers();
    } else if (['+', '=', '-'].includes(event.key)) animateZoom(zoomTarget * (event.key === '-' ? 1 / 1.55 : 1.55));
    else if (event.key === 'Home') centerOn(.5, .5, 1);
    else return;
    event.preventDefault();
  }
});

function startDragging() {
  dragging = true;
  skipClick = true;
  viewport.classList.add('is-dragging');
  for (const id of pointers.keys()) viewport.setPointerCapture(id);
}

viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointers.size === 2) return;
  stopMotion();
  if (!pointers.size) {
    skipClick = false;
    velocity = null;
  }
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, time: event.timeStamp });
  if (pointers.size === 2) startDragging();
});

viewport.addEventListener('pointermove', event => {
  const previous = pointers.get(event.pointerId);
  if (!previous) return;
  const dx = event.clientX - previous.x;
  const dy = event.clientY - previous.y;
  if (!dragging && Math.hypot(dx, dy) < 5) return;
  if (!dragging) startDragging();
  const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
  if (other) {
    const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
    const distance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
    const box = viewport.getBoundingClientRect();
    if (oldDistance > 1) setZoom(clamp(zoom * distance / oldDistance, 1, zoomLimit), (previous.x + other.x) / 2 - box.left, (previous.y + other.y) / 2 - box.top);
    zoomTarget = zoom;
    velocity = null;
  } else {
    const elapsed = Math.max(10, event.timeStamp - previous.time);
    velocity = { x: clamp(dx / elapsed, -2, 2), y: clamp(dy / elapsed, -2, 2), time: event.timeStamp };
  }
  left += dx / pointers.size;
  top += dy / pointers.size;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, time: event.timeStamp });
  keepInsideMap();
  queuePose();
  scheduleMarkers();
});

function releasePointer(event) {
  if (!pointers.delete(event.pointerId) || pointers.size) return;
  dragging = false;
  viewport.classList.remove('is-dragging');
  drawMarkers();
  const fling = velocity;
  if (event.type !== 'pointerup' || !fling || reducedMotion.matches || event.timeStamp - fling.time > 80 || Math.hypot(fling.x, fling.y) < .12) return;
  const started = performance.now();
  let previous = started;
  const frame = time => {
    const friction = Math.exp(-(time - started) / 100);
    const elapsed = Math.min(time - previous, 32);
    previous = time;
    left += fling.x * friction * elapsed;
    top += fling.y * friction * elapsed;
    keepInsideMap();
    drawPose();
    scheduleMarkers();
    animation = friction > .045 ? requestAnimationFrame(frame) : 0;
  };
  animation = requestAnimationFrame(frame);
}

for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(event, releasePointer);
viewport.addEventListener('pointerleave', event => {
  if (!viewport.hasPointerCapture(event.pointerId)) releasePointer(event);
});

new ResizeObserver(resize).observe(viewport);
resize();
filterPanel.open = !smallScreen.matches;
drawPresets();
for (const control of map.querySelectorAll('[data-map-ui]')) control.hidden = false;

async function loadLandmarks() {
  const initialPlace = new URL(location.href).searchParams.get('place');
  try {
    const response = await fetch(map.dataset.landmarks);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    records = data.map(([id, name, category, icon, x, y, county]) => {
      const area = countyFilter.options[county]?.textContent ?? '';
      const countyName = county ? area : '';
      return { id, name, area: countyName, category, icon, x, y, county,
        unconfirmed: name.endsWith('?'),
        search: normalize([name, countyName, categories[category]].join(' ')), searchName: normalize(name) };
    });
    byId = new Map(records.map(record => [record.id, record]));
    for (const id of visited) if (!byId.has(id)) visited.delete(id);
    const counts = new Map();
    for (const record of records) counts.set(record.category, (counts.get(record.category) ?? 0) + 1);
    for (const button of filters) {
      const count = counts.get(button.dataset.category) ?? 0;
      button.querySelector('[data-count]').textContent = count;
      button.hidden = !count;
    }
    drawFilters();
    updateResults();
    if (byId.has(initialPlace)) selectRecord(byId.get(initialPlace), true);
  } catch {
    status.textContent = 'Places could not load. Reload the page to try again.';
    query.disabled = true;
    filterPanel.hidden = true;
  }
}

loadLandmarks();
