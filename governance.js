import { SIGNALS } from './governance-signals.js';

const state = {
  protocols: [],
  topics: [],
  enabledProtocols: new Set(),
  selectedTopicId: null,
  topicSearch: '',
  topicCategory: 'all',
  returnScrollY: null,
};

const els = {
  feed: document.querySelector('#feed'),
  empty: document.querySelector('#empty-state'),
  count: document.querySelector('#feed-count'),
  freshness: document.querySelector('#freshness'),
  filters: document.querySelector('#protocol-filters'),
  feedHeading: document.querySelector('#feed-heading-row'),
  feedControls: document.querySelector('#feed-controls'),
  topicSearch: document.querySelector('#topic-search'),
  topicCategory: document.querySelector('#topic-category'),
  clearFilters: document.querySelector('#clear-filters'),
  themeToggle: document.querySelector('#theme-toggle'),
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const feedDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : dateFormatter.format(date);
}

function formatFeedDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : feedDateFormatter.format(date);
}

function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units = [
    ['y', 31536000],
    ['mo', 2592000],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ];
  for (const [label, size] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return 'just now';
}

function protocolName(id) {
  return state.protocols.find((protocol) => protocol.id === id)?.name || id;
}

function signalTag(topic) {
  if (!SIGNALS[topic.signal]) return null;
  const tag = document.createElement('span');
  tag.className = `signal-tag signal-${topic.signal}`;
  tag.textContent = SIGNALS[topic.signal].label;
  if (topic.signal_reason) tag.title = topic.signal_reason;
  return tag;
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  els.themeToggle.setAttribute('aria-pressed', nextTheme === 'dark' ? 'true' : 'false');
  els.themeToggle.setAttribute('aria-label', `Switch to ${nextTheme === 'dark' ? 'light' : 'dark'} mode`);

  if (persist) {
    try {
      window.localStorage.setItem('defi-dashboard-theme', nextTheme);
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
  }
}

function renderFilters() {
  els.filters.replaceChildren();

  for (const protocol of state.protocols) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'protocol-filter';
    button.textContent = protocol.name;
    button.dataset.protocol = protocol.id;
    button.setAttribute('aria-pressed', state.enabledProtocols.has(protocol.id) ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (state.enabledProtocols.has(protocol.id)) {
        state.enabledProtocols.delete(protocol.id);
      } else {
        state.enabledProtocols.add(protocol.id);
      }
      state.selectedTopicId = null;
      renderFilters();
      renderFeed();
    });
    els.filters.appendChild(button);
  }
}

function renderCategoryFilter() {
  const categories = [...new Set(state.topics.map((topic) => topic.category).filter(Boolean))].sort();
  els.topicCategory.replaceChildren();

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All categories';
  els.topicCategory.appendChild(allOption);

  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    els.topicCategory.appendChild(option);
  }

  els.topicCategory.value = state.topicCategory;
}

function topicMatchesFilters(topic) {
  if (!state.enabledProtocols.has(topic.protocol)) return false;
  if (state.topicCategory !== 'all' && topic.category !== state.topicCategory) return false;

  const query = state.topicSearch.trim().toLowerCase();
  if (!query) return true;

  return [
    topic.title,
    topic.category,
    topic.original_poster,
    topic.proposal_summary,
    topic.proposal_excerpt,
    topic.latest_comment_summary,
    topic.latest_comment_excerpt,
    topic.signal,
    topic.signal_reason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

function renderTopicDetail(topic) {
  const detail = document.createElement('article');
  detail.className = 'topic-detail-view';

  const navigation = document.createElement('div');
  navigation.className = 'topic-detail-navigation';
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'topic-back';
  backButton.textContent = '← Back to feed';
  backButton.addEventListener('click', () => {
    const returnScrollY = state.returnScrollY;
    state.selectedTopicId = null;
    renderFeed();
    state.returnScrollY = null;
    if (returnScrollY !== null) {
      requestAnimationFrame(() => window.scrollTo({ top: returnScrollY, left: 0, behavior: 'auto' }));
    }
  });
  const breadcrumb = document.createElement('span');
  breadcrumb.className = 'topic-breadcrumb';
  breadcrumb.textContent = topic.title;
  navigation.append(backButton, breadcrumb);
  detail.appendChild(navigation);

  const content = document.createElement('div');
  content.className = 'topic-detail-content';

  const kicker = document.createElement('div');
  kicker.className = 'topic-detail-kicker';
  const protocol = document.createElement('span');
  protocol.className = 'protocol-pill';
  protocol.textContent = protocolName(topic.protocol);
  const category = document.createElement('span');
  category.className = 'topic-detail-category';
  category.textContent = topic.category || 'Governance';
  kicker.append(protocol, category);

  const title = document.createElement('h3');
  title.className = 'topic-detail-title';
  title.textContent = topic.title;

  const meta = document.createElement('div');
  meta.className = 'topic-detail-meta';
  meta.textContent = `Posted by @${topic.original_poster || 'unknown'} · ${formatDate(topic.topic_created_at)} · ${topic.reply_count ?? 0} repl${topic.reply_count === 1 ? 'y' : 'ies'}`;

  const postSection = document.createElement('section');
  postSection.className = 'topic-detail-section';
  const postHeading = document.createElement('h4');
  postHeading.textContent = 'Post excerpt';
  const postCopy = document.createElement('p');
  postCopy.className = 'topic-detail-copy';
  postCopy.textContent = topic.proposal_excerpt || 'No post content available.';
  postSection.append(postHeading, postCopy);

  const aiSection = document.createElement('section');
  aiSection.className = 'topic-detail-section topic-ai-section';
  const aiHeadingRow = document.createElement('div');
  aiHeadingRow.className = 'topic-ai-heading-row';
  const aiHeading = document.createElement('h4');
  aiHeading.textContent = 'AI synthesis';
  const tag = signalTag(topic);
  if (tag) aiHeadingRow.append(aiHeading, tag);
  else aiHeadingRow.appendChild(aiHeading);
  const aiCopy = document.createElement('p');
  aiCopy.className = `topic-detail-copy${topic.proposal_summary ? '' : ' is-pending'}`;
  aiCopy.textContent = topic.proposal_summary || 'AI synthesis is pending the next scheduled refresh.';
  aiSection.append(aiHeadingRow, aiCopy);
  if (topic.signal_reason) {
    const reason = document.createElement('p');
    reason.className = 'topic-ai-reason';
    reason.textContent = topic.signal_reason;
    aiSection.appendChild(reason);
  }
  content.append(kicker, title, meta, postSection, aiSection);

  const latestComment = topic.latest_comment_summary || topic.latest_comment_excerpt;
  if (latestComment) {
    const commentSection = document.createElement('section');
    commentSection.className = 'topic-detail-section topic-detail-comment';
    const commentHeading = document.createElement('h4');
    commentHeading.textContent = 'Latest comment';
    const commentMeta = document.createElement('p');
    commentMeta.className = 'topic-detail-comment-meta';
    commentMeta.textContent = `${topic.latest_comment_poster ? `@${topic.latest_comment_poster}` : 'Reply'} · ${formatFeedDate(topic.latest_comment_created_at)}`;
    const commentCopy = document.createElement('p');
    commentCopy.className = 'topic-detail-copy';
    commentCopy.textContent = latestComment;
    commentSection.append(commentHeading, commentMeta, commentCopy);
    content.appendChild(commentSection);
  }

  const sourceLink = document.createElement('a');
  sourceLink.className = 'topic-detail-link';
  sourceLink.href = topic.url;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener noreferrer';
  sourceLink.textContent = 'Open full post on the governance forum';
  content.appendChild(sourceLink);

  detail.appendChild(content);
  els.feed.appendChild(detail);
}

function renderFeed() {
  const selectedTopic = state.topics.find((topic) => String(topic.topic_id) === String(state.selectedTopicId));
  const isDetail = Boolean(selectedTopic);
  els.feedHeading.hidden = isDetail;
  els.feedControls.hidden = isDetail;
  els.empty.hidden = true;
  els.feed.replaceChildren();

  if (isDetail) {
    els.count.textContent = '';
    renderTopicDetail(selectedTopic);
    return;
  }

  const visible = state.topics
    .filter(topicMatchesFilters)
    .sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at));

  els.count.textContent = `${visible.length} post${visible.length === 1 ? '' : 's'}`;
  els.empty.hidden = visible.length > 0;

  for (const topic of visible) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'feed-item';
    item.dataset.topicId = topic.topic_id;
    item.setAttribute('aria-label', `Open governance post: ${topic.title}`);

    const main = document.createElement('span');
    main.className = 'feed-item-main';
    const titleRow = document.createElement('span');
    titleRow.className = 'feed-item-title-row';
    const protocol = document.createElement('span');
    protocol.className = 'feed-item-protocol';
    protocol.textContent = protocolName(topic.protocol);
    const title = document.createElement('span');
    title.className = 'feed-item-title';
    title.textContent = topic.title;
    titleRow.append(protocol, title);
    const tag = signalTag(topic);
    if (tag) titleRow.appendChild(tag);
    const submeta = document.createElement('span');
    submeta.className = 'feed-item-submeta';
    submeta.textContent = `@${topic.original_poster || 'unknown'} · ${topic.category || 'Governance'}`;
    main.append(titleRow, submeta);
    if (topic.proposal_summary) {
      const summary = document.createElement('span');
      summary.className = 'feed-item-summary';
      summary.textContent = topic.proposal_summary;
      main.appendChild(summary);
    }

    const meta = document.createElement('span');
    meta.className = 'feed-item-meta';
    const time = document.createElement('time');
    time.dateTime = topic.last_activity_at || '';
    time.textContent = formatFeedDate(topic.last_activity_at);
    const replies = document.createElement('span');
    replies.textContent = `${topic.reply_count ?? 0} repl${topic.reply_count === 1 ? 'y' : 'ies'}`;
    const arrow = document.createElement('span');
    arrow.className = 'feed-item-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';
    meta.append(time, replies, arrow);

    item.append(main, meta);
    item.addEventListener('click', () => {
      state.returnScrollY = window.scrollY;
      state.selectedTopicId = topic.topic_id;
      renderFeed();
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }));
    });
    els.feed.appendChild(item);
  }
}

function bindFeedControls() {
  els.topicSearch.addEventListener('input', () => {
    state.topicSearch = els.topicSearch.value;
    state.selectedTopicId = null;
    renderFeed();
  });

  els.topicCategory.addEventListener('change', () => {
    state.topicCategory = els.topicCategory.value;
    state.selectedTopicId = null;
    renderFeed();
  });

  els.clearFilters.addEventListener('click', () => {
    state.topicSearch = '';
    state.topicCategory = 'all';
    state.enabledProtocols = new Set(state.protocols.map((protocol) => protocol.id));
    state.selectedTopicId = null;
    els.topicSearch.value = '';
    els.topicCategory.value = 'all';
    renderFilters();
    renderFeed();
  });
}

function bindThemeToggle() {
  applyTheme(document.documentElement.dataset.theme, false);
  els.themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

async function init() {
  try {
    const [protocolResponse, dataResponse] = await Promise.all([
      fetch('./config/protocols.json', { cache: 'no-store' }),
      fetch('./data/governance.json', { cache: 'no-store' }),
    ]);

    if (!protocolResponse.ok) throw new Error(`Protocol config failed: ${protocolResponse.status}`);
    if (!dataResponse.ok) throw new Error(`Feed data failed: ${dataResponse.status}`);

    const protocolConfig = await protocolResponse.json();
    const data = await dataResponse.json();
    state.protocols = protocolConfig.filter((protocol) => protocol.enabled !== false);
    state.topics = Array.isArray(data.topics) ? data.topics : [];
    state.enabledProtocols = new Set(state.protocols.map((protocol) => protocol.id));
    els.freshness.textContent = data.generated_at
      ? `Updated ${relativeTime(data.generated_at)}`
      : 'Feed loaded';

    renderCategoryFilter();
    renderFilters();
    renderFeed();
  } catch (error) {
    console.error(error);
    els.freshness.textContent = 'Feed unavailable';
    els.feed.innerHTML = '<div class="error-state">Could not load governance data. Check the generated JSON and deployment logs.</div>';
  }
}

bindThemeToggle();
bindFeedControls();
init();
