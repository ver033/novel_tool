import Database from 'better-sqlite3';

type SqliteDb = InstanceType<typeof Database>;

export interface MemoryCard {
  id: string;
  kind: 'entity' | 'fact' | 'event' | 'world_rule' | 'foreshadowing';
  title: string;
  body: string;
  sourceParagraphId: string | null;
  sourceQuote: string;
  sourceLocation: string | null;
  confidence: number;
  status: string;
  impact: string;
}

export interface MemoryListResult {
  cards: MemoryCard[];
}

export interface MemoryUpdateInput {
  cardId: string;
  changes: Record<string, unknown>;
}

function friendlyLocation(row: Record<string, unknown>): string | null {
  if (!row.chapter_title || row.paragraph_index === null || row.paragraph_index === undefined) {
    return null;
  }
  return `${String(row.chapter_title)} / 第 ${Number(row.paragraph_index) + 1} 段`;
}

function parseCardId(cardId: string): { kind: MemoryCard['kind']; rawId: string } {
  const [kind, ...rest] = cardId.split(':');
  const rawId = rest.join(':');
  if (!rawId) {
    throw new Error('记忆卡 ID 无效');
  }
  if (!['entity', 'fact', 'event', 'world_rule', 'foreshadowing'].includes(kind)) {
    throw new Error('不支持的记忆卡类型');
  }
  return { kind: kind as MemoryCard['kind'], rawId };
}

function toFactCard(row: Record<string, unknown>): MemoryCard {
  return {
    id: `fact:${String(row.id)}`,
    kind: 'fact',
    title: String(row.predicate),
    body: String(row.object_text),
    sourceParagraphId: row.source_paragraph_id ? String(row.source_paragraph_id) : null,
    sourceQuote: String(row.quote ?? ''),
    sourceLocation: friendlyLocation(row),
    confidence: Number(row.confidence ?? 0),
    status: String(row.status),
    impact: '连续性、事实检查',
  };
}

function toEntityCard(row: Record<string, unknown>): MemoryCard {
  return {
    id: `entity:${String(row.id)}`,
    kind: 'entity',
    title: String(row.canonical_name),
    body: String(row.description ?? ''),
    sourceParagraphId: row.source_paragraph_id ? String(row.source_paragraph_id) : null,
    sourceQuote: '',
    sourceLocation: friendlyLocation(row),
    confidence: Number(row.confidence ?? 0),
    status: String(row.status),
    impact: '角色、人设、名称一致性',
  };
}

function toWorldRuleCard(row: Record<string, unknown>): MemoryCard {
  return {
    id: `world_rule:${String(row.id)}`,
    kind: 'world_rule',
    title: '世界规则',
    body: String(row.rule_text),
    sourceParagraphId: row.source_paragraph_id ? String(row.source_paragraph_id) : null,
    sourceQuote: String(row.quote ?? ''),
    sourceLocation: friendlyLocation(row),
    confidence: Number(row.confidence ?? 0),
    status: String(row.status),
    impact: '世界观、连续性',
  };
}

function toEventCard(row: Record<string, unknown>): MemoryCard {
  return {
    id: `event:${String(row.id)}`,
    kind: 'event',
    title: String(row.time_expression ?? '事件'),
    body: String(row.summary),
    sourceParagraphId: row.paragraph_id ? String(row.paragraph_id) : null,
    sourceQuote: String(row.paragraph_text ?? ''),
    sourceLocation: friendlyLocation(row),
    confidence: Number(row.confidence ?? 0),
    status: String(row.status),
    impact: '时间线、因果',
  };
}

function toForeshadowingCard(row: Record<string, unknown>): MemoryCard {
  return {
    id: `foreshadowing:${String(row.id)}`,
    kind: 'foreshadowing',
    title: '伏笔',
    body: String(row.expected_payoff),
    sourceParagraphId: row.setup_paragraph_id ? String(row.setup_paragraph_id) : null,
    sourceQuote: String(row.paragraph_text ?? ''),
    sourceLocation: friendlyLocation(row),
    confidence: 0,
    status: String(row.status),
    impact: '伏笔回收',
  };
}

export function listMemoryCards(dbPath: string): MemoryListResult {
  const db = new Database(dbPath);
  try {
    const cards: MemoryCard[] = [];
    const facts = db
      .prepare(
        `SELECT facts.*, chapters.title AS chapter_title, paragraphs.paragraph_index
         FROM facts
         LEFT JOIN paragraphs ON paragraphs.id = facts.source_paragraph_id
         LEFT JOIN chapters ON chapters.id = paragraphs.chapter_id
         ORDER BY facts.updated_at DESC, facts.id ASC
         LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>;
    cards.push(...facts.map(toFactCard));

    const entities = db
      .prepare(
        `SELECT entities.*, entity_aliases.source_paragraph_id, chapters.title AS chapter_title, paragraphs.paragraph_index
         FROM entities
         LEFT JOIN entity_aliases ON entity_aliases.entity_id = entities.id
         LEFT JOIN paragraphs ON paragraphs.id = entity_aliases.source_paragraph_id
         LEFT JOIN chapters ON chapters.id = paragraphs.chapter_id
         ORDER BY entities.updated_at DESC, entities.id ASC
         LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>;
    cards.push(...entities.map(toEntityCard));

    const worldRules = db
      .prepare(
        `SELECT world_rules.*, chapters.title AS chapter_title, paragraphs.paragraph_index
         FROM world_rules
         LEFT JOIN paragraphs ON paragraphs.id = world_rules.source_paragraph_id
         LEFT JOIN chapters ON chapters.id = paragraphs.chapter_id
         ORDER BY world_rules.id ASC
         LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>;
    cards.push(...worldRules.map(toWorldRuleCard));

    const events = db
      .prepare(
        `SELECT events.*, paragraphs.text AS paragraph_text, chapters.title AS chapter_title, paragraphs.paragraph_index
         FROM events
         LEFT JOIN paragraphs ON paragraphs.id = events.paragraph_id
         LEFT JOIN chapters ON chapters.id = events.chapter_id
         ORDER BY events.event_order ASC, events.id ASC
         LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>;
    cards.push(...events.map(toEventCard));

    const foreshadowings = db
      .prepare(
        `SELECT foreshadowings.*, paragraphs.text AS paragraph_text, chapters.title AS chapter_title, paragraphs.paragraph_index
         FROM foreshadowings
         LEFT JOIN paragraphs ON paragraphs.id = foreshadowings.setup_paragraph_id
         LEFT JOIN chapters ON chapters.id = paragraphs.chapter_id
         ORDER BY foreshadowings.id ASC
         LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>;
    cards.push(...foreshadowings.map(toForeshadowingCard));

    return { cards };
  } finally {
    db.close();
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function updateFact(db: SqliteDb, rawId: string, changes: Record<string, unknown>): void {
  const objectText = optionalString(changes.objectText);
  const status = optionalString(changes.status);
  if (!objectText && !status) {
    throw new Error('没有可更新的记忆字段');
  }
  const current = db.prepare('SELECT object_text, status FROM facts WHERE id = ?').get(rawId) as
    | Record<string, unknown>
    | undefined;
  if (!current) {
    throw new Error('记忆卡不存在');
  }
  db.prepare('UPDATE facts SET object_text = ?, status = ?, updated_at = ? WHERE id = ?').run(
    objectText ?? String(current.object_text),
    status ?? String(current.status),
    new Date().toISOString(),
    rawId
  );
}

const memoryStatusTables: Record<Exclude<MemoryCard['kind'], 'fact'>, string> = {
  entity: 'entities',
  event: 'events',
  world_rule: 'world_rules',
  foreshadowing: 'foreshadowings',
};

export function updateMemoryCard(dbPath: string, input: MemoryUpdateInput): MemoryCard {
  const { kind, rawId } = parseCardId(input.cardId);
  const db = new Database(dbPath);
  try {
    if (kind === 'fact') {
      updateFact(db, rawId, input.changes);
    } else {
      const status = optionalString(input.changes.status);
      if (!status) {
        throw new Error('当前记忆类型仅支持更新状态');
      }
      const table = memoryStatusTables[kind];
      const result = db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(status, rawId);
      if (result.changes === 0) {
        throw new Error('记忆卡不存在');
      }
    }
  } finally {
    db.close();
  }

  const card = listMemoryCards(dbPath).cards.find((item) => item.id === input.cardId);
  if (!card) {
    throw new Error('记忆卡不存在');
  }
  return card;
}
