import { sql } from 'drizzle-orm';
import { check, date, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, oneOf, tstz } from './columns';
import { crawlRuns, keywords } from './crawl';

export const BRIEFING_SCOPES = ['global', 'keyword'] as const;
export const SUGGESTION_KINDS = ['idea', 'keyword'] as const;
/** Written by the host's ops scripts through `pnpm ops:alert` (phase 2 plan Step 2a), one per dedupe key. */
export const OPS_ALERT_KINDS = ['deploy_failed', 'backup_failed', 'disk_space', 'retention_failed', 'acceptance_failed'] as const;
export const ALERT_KINDS = [
  'blocked',
  'network_error',
  'parse_error',
  'missed_run',
  'run_failed',
  'heartbeat_lost',
  'briefing_late',
  'lark_send_failed',
  'settings_invalid',
  ...OPS_ALERT_KINDS,
] as const;

export const briefings = pgTable(
  'briefings',
  {
    id: id('brf'),
    date: date('date').notNull(),
    scope: text('scope', { enum: BRIEFING_SCOPES }).notNull(),
    keywordId: text('keyword_id').references(() => keywords.id, { onDelete: 'cascade' }),
    sections: jsonb('sections').notNull().default({}),
    aiCostUsd: numeric('ai_cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    /** Counted and committed before each call, so a call cut by a crash still counts. */
    llmCalls: integer('llm_calls').notNull().default(0),
    readyAt: tstz('ready_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('briefings_date_scope_key').on(t.date, t.scope, t.keywordId).nullsNotDistinct(),
    check('briefings_scope_check', oneOf(t.scope, BRIEFING_SCOPES)),
    check('briefings_keyword_check', sql`(${t.scope} = 'keyword') = (${t.keywordId} is not null)`),
  ],
);

export const suggestions = pgTable(
  'suggestions',
  {
    id: id('sug'),
    briefingId: text('briefing_id')
      .notNull()
      .references(() => briefings.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SUGGESTION_KINDS }).notNull(),
    text: text('text').notNull(),
    reason: text('reason').notNull(),
    /** Ads and news items that were in the LLM call's input. */
    evidence: jsonb('evidence').$type<{ ads: string[]; news: string[] }>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('suggestions_kind_check', oneOf(t.kind, SUGGESTION_KINDS))],
);

/** Inserted before the post is sent; `uuid` is Lark's dedupe field. */
export const larkMessages = pgTable(
  'lark_messages',
  {
    id: id('lark'),
    briefingId: text('briefing_id')
      .notNull()
      .references(() => briefings.id, { onDelete: 'cascade' }),
    chat: text('chat').notNull(),
    uuid: text('uuid').notNull().unique(),
    messageId: text('message_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('lark_messages_briefing_chat_key').on(t.briefingId, t.chat)],
);

export const alerts = pgTable(
  'alerts',
  {
    id: id('alert'),
    kind: text('kind', { enum: ALERT_KINDS }).notNull(),
    runId: text('run_id').references(() => crawlRuns.id, { onDelete: 'cascade' }),
    briefingId: text('briefing_id').references(() => briefings.id, { onDelete: 'cascade' }),
    /** For network_error: the run's network_cooldowns count after the increment it belongs to. */
    cooldownSeq: integer('cooldown_seq'),
    affectedSearches: integer('affected_searches'),
    detail: text('detail'),
    createdAt: createdAt(),
    resolvedAt: tstz('resolved_at'),
    larkMessageId: text('lark_message_id'),
    sentAt: tstz('sent_at'),
    /** Set instead of sent_at when the watchdog found the Alert unsent past the cut-off (ADR 0004). */
    larkSkippedAt: tstz('lark_skipped_at'),
    /** Ops Alerts: `<sha>:<stage>`, `<date>:<stage>`, `<date>:<filesystem>:<level>`, `<date>` (retention, acceptance); tests use `test:<timestamp>`. */
    dedupeKey: text('dedupe_key'),
  },
  (t) => [
    check('alerts_kind_check', oneOf(t.kind, ALERT_KINDS)),
    // Dedupe (spec §2 "Alert").
    uniqueIndex('alerts_run_kind_key')
      .on(t.runId, t.kind)
      .where(sql`${t.kind} in ('blocked', 'parse_error', 'missed_run', 'run_failed')`),
    uniqueIndex('alerts_network_cooldown_key')
      .on(t.runId, t.cooldownSeq)
      .where(sql`${t.kind} = 'network_error'`),
    uniqueIndex('alerts_open_heartbeat_key')
      .on(t.kind)
      .where(sql`${t.kind} = 'heartbeat_lost' and ${t.resolvedAt} is null`),
    uniqueIndex('alerts_briefing_kind_key')
      .on(t.briefingId, t.kind)
      .where(sql`${t.kind} in ('briefing_late', 'lark_send_failed')`),
    // One per Asia/Ho_Chi_Minh day for the scheduler's rejected settings.
    uniqueIndex('alerts_settings_invalid_day_key')
      .on(sql`((${t.createdAt} at time zone 'Asia/Ho_Chi_Minh')::date)`)
      .where(sql`${t.kind} = 'settings_invalid'`),
    uniqueIndex('alerts_ops_dedupe_key')
      .on(t.kind, t.dedupeKey)
      .where(sql`${t.kind} in ('deploy_failed', 'backup_failed', 'disk_space', 'retention_failed', 'acceptance_failed')`),
    check(
      'alerts_ref_check',
      sql`case
        when ${t.kind} in ('blocked', 'parse_error', 'missed_run', 'run_failed') then ${t.runId} is not null
        when ${t.kind} = 'network_error' then ${t.runId} is not null and ${t.cooldownSeq} is not null
        when ${t.kind} in ('briefing_late', 'lark_send_failed') then ${t.briefingId} is not null
        else true end`,
    ),
  ],
);
