/** Thin fetch wrapper for mockability at the L1 boundary. */
export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.json() as Promise<T>
}

/** Raw fetch wrapper — returns the full Response for callers that need headers, status, streaming, etc. */
export async function fetchRaw(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, options)
}
