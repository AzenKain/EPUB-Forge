import { emptyMetadata, type BookAnalysis } from "./types";

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || response.statusText);
  }
  return response.json() as Promise<T>;
}

export function normalizeAnalysis(value: BookAnalysis): BookAnalysis {
  return {
    ...value,
    metadata: { ...emptyMetadata, ...(value.metadata || {}) },
    spine: Array.isArray(value.spine) ? value.spine : [],
    detectedVolumes: Array.isArray(value.detectedVolumes) ? value.detectedVolumes : []
  };
}

export function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
