import { NOTICES, type NoticeCode, type WriteAccepted, type WriteNotice, type WritePreview } from "./generated.ts";

/**
 * Notices: what a write did NOT do, or will not go on doing. Every answer of `zs.availability.set`,
 * `zs.rates.set` and `zs.restrictions.set`, and every dry run of them, may carry `notices`: one plain
 * sentence each, with a stable `code`, a `level` (warning or info), what it is about and what to do.
 *
 * Branch on `code`; show `message` and `action` to the person who saved. A notice is never a refusal:
 * the write was accepted. A code this version does not know was added later: show it all the same.
 */

/** Anything that can carry notices: an accepted write, a dry run's preview. */
export interface NoticeCarrier {
  notices?: WriteNotice[];
  noticesOmitted?: number;
}

const listOf = (answers: NoticeCarrier | readonly (NoticeCarrier | null | undefined)[] | null | undefined): NoticeCarrier[] =>
  (Array.isArray(answers) ? answers : [answers]).filter((a): a is NoticeCarrier => a !== null && a !== undefined && typeof a === "object");

/**
 * Every notice of one answer, or of all the answers of a write the client split into several requests:
 * warnings first, each once. Pass what `set` or `dryRun` returned.
 *
 * @example
 * const accepted = await zs.restrictions.set([{ ratePlanId: 901, dateFrom: night, dateTo: night, stopSell: true }]);
 * for (const notice of noticesOf(accepted)) showToThePerson(notice.level, notice.message, notice.action);
 */
export function noticesOf(answers: NoticeCarrier | readonly (NoticeCarrier | null | undefined)[] | null | undefined): WriteNotice[] {
  const seen = new Set<string>();
  const all: WriteNotice[] = [];
  for (const answer of listOf(answers)) {
    for (const notice of answer.notices ?? []) {
      // The same notice on two parts of one split write is said once.
      const key = JSON.stringify([notice.code, notice.roomTypeId, notice.ratePlanIds, notice.dateFrom, notice.dateTo]);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(notice);
    }
  }
  return [...all.filter((n) => n.level === "warning"), ...all.filter((n) => n.level !== "warning")];
}

/** Only the warnings: what you sent does not do the whole job (something still sells, nothing is sent, a rule of the hotel will undo it). */
export function warningsOf(answers: NoticeCarrier | readonly (NoticeCarrier | null | undefined)[] | null | undefined): WriteNotice[] {
  return noticesOf(answers).filter((n) => n.level === "warning");
}

/** How many notices were left out of the answers past the 20 each lists (`noticesOmitted`). 0 when none were. */
export function noticesOmittedFrom(answers: NoticeCarrier | readonly (NoticeCarrier | null | undefined)[] | null | undefined): number {
  return listOf(answers).reduce((sum, a) => sum + (typeof a.noticesOmitted === "number" ? a.noticesOmitted : 0), 0);
}

/**
 * The first notice with this code, or undefined. `code` is one of the contract's (`NOTICES` lists them
 * with what each means), so a typo does not compile.
 *
 * @example
 * const stillSelling = findNotice(accepted, "ROOM_STILL_ON_SALE");
 * if (stillSelling) offerToCloseTheRoomType(stillSelling.roomTypeId, stillSelling.otherRatePlanIds);
 */
export function findNotice(answers: NoticeCarrier | readonly (NoticeCarrier | null | undefined)[] | null | undefined, code: NoticeCode): WriteNotice | undefined {
  return noticesOf(answers).find((n) => n.code === code);
}

/** What a notice code means, in the contract's own sentence; undefined for a code added after this version. */
export function noticeMeaning(code: string): string | undefined {
  return NOTICES.find((n) => n.code === code)?.means;
}

/**
 * Is this answer a dry run's preview (nothing was written) and not an accepted write? `zs.rates.dryRun`
 * and `zs.rates.set` already answer two different types; this is for an answer that came through
 * `zs.request("PUT /rates", …)`, whose type is either.
 */
export function isWritePreview(answer: WriteAccepted | WritePreview | null | undefined): answer is WritePreview {
  return answer !== null && answer !== undefined && (answer as { dryRun?: unknown }).dryRun === true;
}
