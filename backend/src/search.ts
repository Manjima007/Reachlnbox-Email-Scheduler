import { Client } from '@elastic/elasticsearch';
import { elasticEnabled, env } from './env';
import { prisma } from './db';

export interface IndexedEmail {
  id: string;
  userId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: string;
  sendAt: string;
  sentAt: string | null;
}

const client = elasticEnabled
  ? new Client({ node: env.ELASTICSEARCH_NODE, requestTimeout: 3000 })
  : null;

let indexReady: Promise<boolean> | null = null;

async function ensureIndex(): Promise<boolean> {
  if (!client) return false;
  if (!indexReady) {
    indexReady = (async () => {
      const exists = await client.indices.exists({ index: env.ELASTICSEARCH_INDEX });
      if (!exists) {
        await client.indices.create({
          index: env.ELASTICSEARCH_INDEX,
          mappings: {
            properties: {
              id: { type: 'keyword' },
              userId: { type: 'keyword' },
              toEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              fromEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              subject: { type: 'text' },
              body: { type: 'text' },
              status: { type: 'keyword' },
              sendAt: { type: 'date' },
              sentAt: { type: 'date' },
            },
          },
        });
      }
      return true;
    })().catch((error) => {
      console.warn('[elasticsearch] unavailable, DB fallback enabled:', error instanceof Error ? error.message : error);
      return false;
    });
  }
  return indexReady;
}

export interface EmailLike {
  id: string;
  userId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: string;
  sendAt: Date;
  sentAt: Date | null;
}

export function toIndexedEmail(email: EmailLike): IndexedEmail {
  return {
    id: email.id,
    userId: email.userId,
    toEmail: email.toEmail,
    fromEmail: email.fromEmail,
    subject: email.subject,
    body: email.body,
    status: email.status,
    sendAt: email.sendAt.toISOString(),
    sentAt: email.sentAt ? email.sentAt.toISOString() : null,
  };
}

export async function indexEmail(email: EmailLike): Promise<void> {
  if (!client || !(await ensureIndex())) return;
  await client.index({
    index: env.ELASTICSEARCH_INDEX,
    id: email.id,
    document: toIndexedEmail(email),
  });
}

export async function indexEmails(emails: EmailLike[]): Promise<void> {
  if (!client || !(await ensureIndex()) || emails.length === 0) return;
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    await client.bulk({
      refresh: false,
      operations: chunk.flatMap((email) => [
        { index: { _index: env.ELASTICSEARCH_INDEX, _id: email.id } },
        toIndexedEmail(email),
      ]),
    });
  }
}

export async function searchEmails(
  userId: string,
  query: string,
  limit: number,
): Promise<{ source: 'elasticsearch' | 'database'; emails: IndexedEmail[] }> {
  if (client && (await ensureIndex())) {
    const response = await client.search<IndexedEmail>({
      index: env.ELASTICSEARCH_INDEX,
      size: limit,
      query: {
        bool: {
          filter: [{ term: { userId } }],
          should: [
            { multi_match: { query, fields: ['toEmail^3', 'subject^2', 'fromEmail', 'body'], fuzziness: 'AUTO' } },
            { wildcard: { 'toEmail.keyword': `*${query.toLowerCase()}*` } },
          ],
          minimum_should_match: 1,
        },
      },
      sort: [{ sendAt: 'desc' }],
    });
    return {
      source: 'elasticsearch',
      emails: response.hits.hits.map((hit) => hit._source).filter(Boolean) as IndexedEmail[],
    };
  }

  const rows = await prisma.email.findMany({
    where: {
      userId,
      OR: [
        { toEmail: { contains: query, mode: 'insensitive' } },
        { fromEmail: { contains: query, mode: 'insensitive' } },
        { subject: { contains: query, mode: 'insensitive' } },
        { body: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { sendAt: 'desc' },
    take: limit,
  });
  return { source: 'database', emails: rows.map(toIndexedEmail) };
}
