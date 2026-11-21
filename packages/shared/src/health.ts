import { z } from 'zod';

export const databaseDialectSchema = z.enum(['sqlite', 'postgres']);
export type DatabaseDialect = z.infer<typeof databaseDialectSchema>;

export const healthResponseSchema = z.object({
	status: z.literal('ok'),
	version: z.string(),
	database: databaseDialectSchema
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
