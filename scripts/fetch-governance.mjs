import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'config', 'protocols.json');
const outputPath = path.join(root, 'data', 'governance.json');

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const previousTopics = new Map();

try {
  const previousData = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  for (const topic of previousData.topics || []) {
    previousTopics.set(`${topic.protocol}:${topic.topic_id}`, topic);
  }
} catch {
  // The first ingestion has no prior AI output to carry forward.
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeaders(protocol) {
  const prefix = protocol.id.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const apiKey = process.env[`${prefix}_DISCOURSE_API_KEY`] || process.env.DISCOURSE_API_KEY;
  const apiUsername = process.env[`${prefix}_DISCOURSE_API_USERNAME`] || process.env.DISCOURSE_API_USERNAME;
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'defi-governance-monitor/0.1 (+GitHub Pages ingestion)',
  };
  if (apiKey) headers['Api-Key'] = apiKey;
  if (apiUsername) headers['Api-Username'] = apiUsername;
  return headers;
}

async function getJson(url, protocol, attempt = 1) {
  const response = await fetch(url, { headers: authHeaders(protocol) });
  if (response.ok) return response.json();

  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    const retryAfter = Number(response.headers.get('retry-after')) || attempt * 2;
    await sleep(retryAfter * 1000);
    return getJson(url, protocol, attempt + 1);
  }

  const body = await response.text().catch(() => '');
  throw new Error(`${response.status} ${response.statusText} for ${url}\n${body.slice(0, 300)}`);
}

function decodeEntities(value) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  return value
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (match) => entities[match] || match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlToText(html = '') {
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function excerpt(post, max = 1200) {
  if (!post) return null;
  const raw = typeof post.raw === 'string' && post.raw.trim() ? post.raw : htmlToText(post.cooked || '');
  if (!raw) return null;
  return raw.length > max ? `${raw.slice(0, max).trim()}…` : raw.trim();
}

async function resolveWhitelistedUsers(protocol) {
  const users = new Set(protocol.whitelist?.users || []);
  const groups = protocol.whitelist?.groups || [];

  for (const groupName of groups) {
    let offset = 0;
    for (let page = 0; page < 10; page += 1) {
      const url = `${protocol.forum}/groups/${encodeURIComponent(groupName)}/members.json?limit=100&offset=${offset}`;
      try {
        const payload = await getJson(url, protocol);
        const members = payload.members || [];
        for (const member of members) {
          if (member.username) users.add(member.username);
        }
        if (members.length < 100) break;
        offset += members.length;
      } catch (error) {
        console.warn(`[${protocol.id}] Could not resolve group ${groupName}: ${error.message}`);
        break;
      }
    }
  }

  return users;
}

async function latestTopics(protocol) {
  const pages = Math.max(1, Math.min(Number(protocol.latest_pages || 1), 8));
  const topics = [];
  const users = new Map();

  for (let page = 0; page < pages; page += 1) {
    const suffix = page === 0 ? '' : `?page=${page}`;
    const payload = await getJson(`${protocol.forum}/latest.json${suffix}`, protocol);
    for (const user of payload.users || []) {
      users.set(user.id, user.username);
    }
    topics.push(...(payload.topic_list?.topics || []));
  }

  return { topics, users };
}

async function fetchLastPost(protocol, topicDetail) {
  const stream = topicDetail.post_stream?.stream || [];
  if (stream.length <= 1) return null;
  const lastPostId = stream.at(-1);
  const loadedPosts = topicDetail.post_stream?.posts || [];
  const alreadyLoaded = loadedPosts.find((post) => post.id === lastPostId);
  if (alreadyLoaded) return alreadyLoaded;

  const params = new URLSearchParams();
  params.append('post_ids[]', String(lastPostId));
  const payload = await getJson(`${protocol.forum}/t/${topicDetail.id}/posts.json?${params.toString()}`, protocol);
  return payload.post_stream?.posts?.[0] || null;
}

async function ingestProtocol(protocol) {
  const allowedUsers = await resolveWhitelistedUsers(protocol);
  const { topics, users } = await latestTopics(protocol);
  const output = [];

  for (const topic of topics) {
    const guessedOpId = topic.posters?.[0]?.user_id;
    const guessedOp = users.get(guessedOpId);

    // Pre-filter when latest.json gives us enough identity information.
    if (allowedUsers.size > 0 && guessedOp && !allowedUsers.has(guessedOp)) continue;

    try {
      const detail = await getJson(`${protocol.forum}/t/${topic.id}.json`, protocol);
      const firstPost = detail.post_stream?.posts?.find((post) => post.post_number === 1)
        || detail.post_stream?.posts?.[0];
      const op = firstPost?.username || guessedOp;

      // The admission rule is the original topic author, never a later commenter.
      if (allowedUsers.size > 0 && (!op || !allowedUsers.has(op))) continue;

      const lastPost = await fetchLastPost(protocol, detail);
      const hasComment = lastPost && lastPost.post_number > 1;
      const slug = topic.slug || detail.slug || 'topic';
      const proposalContent = excerpt(firstPost, 8000);
      const previous = previousTopics.get(`${protocol.id}:${topic.id}`);
      const previousContent = previous?.proposal_content || previous?.proposal_excerpt || null;
      const sameProposal = previous && previousContent === proposalContent;

      output.push({
        protocol: protocol.id,
        topic_id: topic.id,
        slug,
        url: `${protocol.forum}/t/${slug}/${topic.id}`,
        title: topic.title || detail.title || 'Untitled topic',
        category: detail.category_id ? (detail.category_name || topic.category_name || String(detail.category_id)) : (topic.category_name || null),
        category_id: topic.category_id ?? detail.category_id ?? null,
        topic_created_at: topic.created_at || firstPost?.created_at || null,
        last_activity_at: topic.last_posted_at || topic.bumped_at || lastPost?.created_at || firstPost?.created_at || null,
        original_poster: op || null,
        latest_poster: hasComment ? lastPost.username : op || topic.last_poster_username || null,
        reply_count: topic.reply_count ?? Math.max(0, (topic.posts_count || 1) - 1),
        views: topic.views ?? null,
        proposal_excerpt: excerpt(firstPost),
        proposal_content: proposalContent,
        proposal_summary: sameProposal ? previous.proposal_summary : null,
        signal: sameProposal ? previous.signal : null,
        signal_reason: sameProposal ? previous.signal_reason : null,
        ai_synthesized_at: sameProposal ? previous.ai_synthesized_at : null,
        ai_model: sameProposal ? previous.ai_model : null,
        latest_comment_excerpt: hasComment ? excerpt(lastPost, 900) : null,
        latest_comment_summary: null,
        latest_comment_poster: hasComment ? lastPost.username : null,
        latest_comment_created_at: hasComment ? lastPost.created_at : null,
      });

      await sleep(90);
    } catch (error) {
      console.warn(`[${protocol.id}] Skipping topic ${topic.id}: ${error.message}`);
    }
  }

  console.log(`[${protocol.id}] ${output.length} whitelisted topics from ${topics.length} latest topics`);
  return output;
}

const allTopics = [];
for (const protocol of config.filter((item) => item.enabled !== false)) {
  try {
    allTopics.push(...await ingestProtocol(protocol));
  } catch (error) {
    console.error(`[${protocol.id}] ingestion failed: ${error.message}`);
  }
}

allTopics.sort((a, b) => new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0));

await fs.writeFile(outputPath, `${JSON.stringify({
  generated_at: new Date().toISOString(),
  topics: allTopics,
}, null, 2)}\n`, 'utf8');

console.log(`Wrote ${allTopics.length} topics to ${outputPath}`);
