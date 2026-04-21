/**
 * Parse a `--publish-by` CLI value into an ISO date string (YYYY-MM-DD).
 *
 * Accepts either a relative offset (`+Nd`, e.g. `+7d`) or an absolute
 * ISO 8601 calendar date (`YYYY-MM-DD`).
 *
 * @throws {Error} if the value is neither a valid relative offset nor a valid ISO date.
 */
export function parsePublishBy(raw: string): string {
  const trimmed = raw.trim()
  const relativeMatch = trimmed.match(/^\+(\d+)d$/i)
  if (relativeMatch) {
    return new Date(Date.now() + parseInt(relativeMatch[1], 10) * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
  if (!isoDatePattern.test(trimmed)) {
    throw new Error(
      `Invalid --publish-by value "${trimmed}". Expected "+Nd" (e.g., +7d) or ISO date "YYYY-MM-DD".`,
    )
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid --publish-by date "${trimmed}". Provide a valid calendar date in "YYYY-MM-DD" format or use "+Nd".`,
    )
  }

  return parsed.toISOString().split('T')[0]
}
