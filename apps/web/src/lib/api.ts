import { healthResponseSchema, type HealthResponse } from '@inventory/shared';

export async function fetchHealth(fetchFn: typeof fetch = fetch): Promise<HealthResponse> {
	const res = await fetchFn('/api/health');
	if (!res.ok) throw new Error(`API returned ${res.status}`);
	return healthResponseSchema.parse(await res.json());
}
