import { QueryClient, hashKey } from '@tanstack/react-query';
import { currentWorkspace } from '@/lib/workspace';


export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			// Keep loaded data a day (instead of 5 min) so mail read earlier is still there offline.
			gcTime: 24 * 60 * 60 * 1000,
			// PB Abbey and Carnas share the same query keys (['receipts'] …): keep their caches apart.
			queryKeyHashFn: (key) => `${currentWorkspace()}:${hashKey(key)}`,
		},
	},
});