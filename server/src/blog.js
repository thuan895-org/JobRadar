// Blog posts, written in the admin app (Markdown) and served as plain HTML pages.
import { randomUUID } from 'node:crypto';
import { q } from './db.js';
import { plainText } from './markdown.js';

const now = () => new Date().toISOString();

/** "Cách nhận tiền từ Upwork về Việt Nam" -> "cach-nhan-tien-tu-upwork-ve-viet-nam" */
export function slugify(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'bai-viet';
}

function clean(input) {
  const title = String(input.title ?? '').trim().slice(0, 200);
  if (!title) throw Object.assign(new Error('Bài viết cần tiêu đề.'), { status: 400 });
  const slug = slugify(input.slug || title);
  const body = String(input.body ?? '').slice(0, 100000);
  const excerpt = String(input.excerpt ?? '').trim().slice(0, 300) || plainText(body).slice(0, 200);
  const status = input.status === 'published' ? 'published' : 'draft';
  return { title, slug, body, excerpt, status };
}

async function slugTaken(slug, exceptId) {
  const { rows } = await q('SELECT id FROM posts WHERE slug = $1 AND id <> $2', [slug, exceptId ?? '']);
  return rows.length > 0;
}

export async function createPost(input, authorId) {
  const p = clean(input);
  if (await slugTaken(p.slug)) throw Object.assign(new Error(`Đường dẫn "${p.slug}" đã có bài khác dùng.`), { status: 409 });
  const t = now();
  const { rows } = await q(`INSERT INTO posts (id, slug, title, excerpt, body, status, published_at, created_at, updated_at, author_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9) RETURNING *`,
  [randomUUID(), p.slug, p.title, p.excerpt, p.body, p.status, p.status === 'published' ? t : null, t, authorId]);
  return rows[0];
}

export async function updatePost(id, input) {
  const { rows: old } = await q('SELECT * FROM posts WHERE id = $1', [id]);
  if (!old[0]) return null;
  const p = clean(input);
  if (await slugTaken(p.slug, id)) throw Object.assign(new Error(`Đường dẫn "${p.slug}" đã có bài khác dùng.`), { status: 409 });
  // The first publication date stays, so links and the sitemap keep their order.
  const publishedAt = p.status === 'published' ? old[0].published_at ?? now() : old[0].published_at;
  const { rows } = await q(`UPDATE posts SET slug = $2, title = $3, excerpt = $4, body = $5, status = $6, published_at = $7, updated_at = $8
    WHERE id = $1 RETURNING *`, [id, p.slug, p.title, p.excerpt, p.body, p.status, publishedAt, now()]);
  return rows[0];
}

export async function removePost(id) {
  const { rowCount } = await q('DELETE FROM posts WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function listPosts({ publishedOnly = true, limit = 100 } = {}) {
  const { rows } = await q(`SELECT id, slug, title, excerpt, status, published_at, updated_at, created_at FROM posts
    ${publishedOnly ? "WHERE status = 'published'" : ''} ORDER BY COALESCE(published_at, created_at) DESC LIMIT $1`, [limit]);
  return rows;
}

export async function getPost({ id, slug }) {
  const { rows } = id ? await q('SELECT * FROM posts WHERE id = $1', [id]) : await q("SELECT * FROM posts WHERE slug = $1 AND status = 'published'", [slug]);
  return rows[0] ?? null;
}
